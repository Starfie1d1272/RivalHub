import { randomUUID } from "node:crypto";
import type { Pool, QueryResult } from "pg";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { generateShortSwissRoundPairings } from "@/lib/competition-qualification/swiss";
import { loadQualificationSwissMatchRecord, loadQualificationSwissStageReadModel } from "@/lib/matches/qualification-stage-read-model";
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

async function fixture() {
  const seasonId = randomUUID();
  const entries = Array.from({ length: 4 }, (_, i) => ({ id: randomUUID(), user: randomUUID(), revision: randomUUID(), seed: i + 1 }));
  await db.transaction(async tx => {
    await tx.insert(schema.users).values(entries.map(e => ({ id: e.user, email: `${e.user}@local.test` })));
    await tx.insert(schema.seasons).values({ id: seasonId, slug: seasonId, name: "Swiss record fixture", kind: "custom", status: "playing" });
    await tx.insert(schema.competitionEntries).values(entries.map(e => ({ id: e.id, competitionId: seasonId, source: "event_native" as const,
      name: `Entry ${e.seed}`, logoUrl: `/fixture-${e.seed}.png`, representativeUserId: e.user,
      currentRosterRevisionId: e.revision, approvedRosterRevisionId: e.revision, registrationStatus: "approved" as const })));
    await tx.insert(schema.competitionEntryRepresentativeChanges).values(entries.map(e => ({ entryId: e.id, toUserId: e.user, changedByActorId: "fixture" })));
    await tx.insert(schema.competitionEntryRosterRevisions).values(entries.map(e => ({ id: e.revision, entryId: e.id, revisionNumber: 1,
      status: "approved" as const, createdBy: e.user, approvedAt: new Date() })));
  });
  const [run] = await db.insert(schema.competitionQualificationRuns).values({ seasonId, format: "short_swiss_2w2l", targetEntrantCount: 2,
    candidateCount: 4, directEntryCount: 0, playInEntryCount: 4, qualifierCount: 2, configuredBy: "fixture" }).returning();
  await db.insert(schema.competitionQualificationEntrants).values(entries.map(e => ({ seasonId, runId: run!.id, competitionEntryId: e.id, preliminarySeed: e.seed })));
  const entrants = entries.map(e => ({ teamId: e.id, initialSeed: e.seed }));
  const pairs = generateShortSwissRoundPairings({ entrants, matches: [], completedRound: 0 });
  const first = await db.insert(schema.matches).values(pairs.map(p => ({ seasonId, qualificationRunId: run!.id, stage: "play-in", round: 1,
    entryAId: p.higherSeedTeamId, entryBId: p.lowerSeedTeamId, format: "bo1" as const, status: "finished" as const,
    scoreA: 1, scoreB: 0, completedAt: new Date() }))).returning();
  await db.insert(schema.matchMaps).values(first.map(m => ({ matchId: m.id, mapOrder: 1, mapName: "de_nuke", scoreA: 13, scoreB: 7, completedAt: new Date() })));
  const nextPairs = generateShortSwissRoundPairings({ entrants, completedRound: 1,
    matches: first.map(m => ({ matchId: m.id, round: 1, entryAId: m.entryAId!, entryBId: m.entryBId!, winnerId: m.entryAId! })) });
  const second = await db.insert(schema.matches).values(nextPairs.map(p => ({ seasonId, qualificationRunId: run!.id, stage: "play-in", round: 2,
    entryAId: p.higherSeedTeamId, entryBId: p.lowerSeedTeamId, format: "bo1" as const }))).returning();
  return { seasonId, entries, run: run!, first, second };
}

async function measure<T>(read: () => Promise<T>) {
  const pool = (db as typeof db & { $client: Pool }).$client;
  const original = pool.query;
  const footprint = { queries: 0, rows: 0, jsonBytes: 0 };
  pool.query = ((...args: unknown[]) => Promise.resolve(Reflect.apply(original, pool, args) as Promise<QueryResult>).then(result => {
    if (result.command === "SELECT") { footprint.queries++; footprint.rows += result.rows.length; footprint.jsonBytes += Buffer.byteLength(JSON.stringify(result.rows)); }
    return result;
  })) as typeof pool.query;
  try { return { data: await read(), footprint }; } finally { pool.query = original; }
}

it("projects one canonical pre-round record without identity or display-map reads", async () => {
  const f = await fixture();
  const full = await measure(() => loadQualificationSwissStageReadModel(f.seasonId));
  const narrow = await measure(() => loadQualificationSwissMatchRecord(f.seasonId, f.second[0]!.id));
  const group = full.data!.rounds.flatMap(r => r.groups).find(g => g.matchups.some(m => m.matchId === f.second[0]!.id))!;
  expect(narrow.data).toEqual({ stageName: full.data!.stageName, record: group.record });
  expect(narrow.data!.record).toBe("1:0");
  expect(narrow.footprint.queries).toBe(3);
  expect(full.footprint.queries).toBe(4);
  expect(narrow.footprint.rows).toBeLessThan(full.footprint.rows);
  expect(narrow.footprint.jsonBytes).toBeLessThan(full.footprint.jsonBytes);
  console.info("QUALIFICATION_MATCH_RECORD_AB", JSON.stringify({ baseline: full.footprint, candidate: narrow.footprint }));
  await db.update(schema.competitionEntries).set({ name: "Renamed", logoUrl: null }).where(eq(schema.competitionEntries.id, f.entries[0]!.id));
  await db.update(schema.matchMaps).set({ scoreA: 16, scoreB: 14 }).where(eq(schema.matchMaps.matchId, f.first[0]!.id));
  expect(await loadQualificationSwissMatchRecord(f.seasonId, f.second[0]!.id)).toEqual(narrow.data);
});

it("rejects a foreign/missing target and a non-Swiss run", async () => {
  const a = await fixture(), b = await fixture();
  expect(await loadQualificationSwissMatchRecord(a.seasonId, b.first[0]!.id)).toBeNull();
  expect(await loadQualificationSwissMatchRecord(randomUUID(), a.first[0]!.id)).toBeNull();
  expect(await loadQualificationSwissMatchRecord(a.seasonId, randomUUID())).toBeNull();
  await db.update(schema.competitionQualificationRuns).set({ format: "direct_bo3" }).where(eq(schema.competitionQualificationRuns.id, a.run.id));
  expect(await loadQualificationSwissMatchRecord(a.seasonId, a.first[0]!.id)).toBeNull();
});

it("rejects the requested match when another frozen pairing is missing or corrupt", async () => {
  const f = await fixture();
  const target = f.second[0]!.id;
  await db.update(schema.matches).set({ entryBId: f.first[0]!.entryBId }).where(eq(schema.matches.id, f.first[1]!.id));
  expect(await loadQualificationSwissStageReadModel(f.seasonId)).toBeNull();
  expect(await loadQualificationSwissMatchRecord(f.seasonId, target)).toBeNull();
});

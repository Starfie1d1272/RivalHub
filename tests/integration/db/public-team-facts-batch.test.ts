import { randomUUID } from "node:crypto";
import type { Pool, QueryResult } from "pg";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { getPublicEventTeamMatchFacts, getPublicEventTeamMatchFactsBatch, getPublicEventTeamMatchSummary } from "@/lib/competition-entries/public-team-context";
import { seedFixture } from "./harness/mizar";
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

async function withFinishedBo1() {
  const f = await seedFixture();
  const [match] = await db.insert(schema.matches).values({ seasonId: f.seasonId, entryAId: f.entryAId, entryBId: f.entryBId,
    stage: "history", format: "bo1", status: "finished", scoreA: 1, scoreB: 0, completedAt: new Date("2026-01-01") }).returning();
  await db.insert(schema.matchMaps).values({ matchId: match!.id, mapOrder: 1, mapName: "de_nuke", scoreA: 13, scoreB: 7, completedAt: new Date("2026-01-01") });
  return { ...f, finishedId: match!.id };
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

it("batches three seasons without changing BO1 facts, side orientation, ordering or empty records", async () => {
  const fixtures = await Promise.all([withFinishedBo1(), withFinishedBo1(), withFinishedBo1()]);
  const empty = randomUUID(), emptySeason = randomUUID();
  const scopes = fixtures.map(f => ({ seasonId: f.seasonId, entryIds: [f.entryAId, f.entryBId, empty] }));
  const baselineModule = process.env.RIVALHUB_TEAM_FACTS_BASELINE;
  const baselineReader = baselineModule
    ? ((await import(baselineModule)) as { getPublicEventTeamMatchFacts: typeof getPublicEventTeamMatchFacts }).getPublicEventTeamMatchFacts
    : getPublicEventTeamMatchFacts;
  const full = await measure(() => Promise.all(scopes.map(s => baselineReader(s.seasonId, s.entryIds))));
  const batch = await measure(() => getPublicEventTeamMatchFactsBatch([...scopes, { seasonId: emptySeason, entryIds: [] }]));
  expect(batch.footprint.queries).toBe(3);
  expect(full.footprint.queries).toBe(9);
  expect(batch.footprint.rows).toBe(full.footprint.rows);
  for (const [i, f] of fixtures.entries()) {
    const result = batch.data.get(f.seasonId)!;
    expect(result).toEqual(full.data[i]);
    expect(result.get(f.entryAId)).toMatchObject({ record: { played: 1, wins: 1, losses: 0, winRate: "100%" } });
    expect(result.get(f.entryBId)).toMatchObject({ record: { played: 1, wins: 0, losses: 1, winRate: "0%" } });
    expect(result.get(f.entryAId)!.matches.map(m => m.id)).toEqual([f.finishedId, f.matchId]);
    expect(result.get(f.entryAId)!.matches[0]).toMatchObject({ opponentId: f.entryBId, opponentName: "Provider B", ownScore: 1, opponentScore: 0, displayScore: { own: 13, opponent: 7 } });
    expect(result.get(f.entryBId)!.matches[0]).toMatchObject({ displayScore: { own: 7, opponent: 13 }, ownScore: 0, opponentScore: 1 });
    expect(result.get(empty)).toEqual({ record: { played: 0, wins: 0, losses: 0, winRate: "—" }, matches: [] });
  }
  expect(batch.data.get(emptySeason)).toEqual(new Map());
  console.info("PUBLIC_TEAM_FACTS_BATCH_AB", JSON.stringify({ comparison: baselineModule ? "exact original single-season reader" : "current single-season reader", seasons: 3, baseline: full.footprint, candidate: batch.footprint }));
});

it("keeps exact season-entry scopes and official/test exclusion with duplicate or empty input", async () => {
  const a = await withFinishedBo1(), b = await withFinishedBo1();
  const test = await seedFixture({ isTest: true });
  const empty = await measure(() => getPublicEventTeamMatchFactsBatch([]));
  expect(empty.data.size).toBe(0); expect(empty.footprint.queries).toBe(0);
  const emptyScopes = await measure(() => getPublicEventTeamMatchFactsBatch([{ seasonId: a.seasonId, entryIds: [] }]));
  expect(emptyScopes.data.get(a.seasonId)).toEqual(new Map()); expect(emptyScopes.footprint.queries).toBe(0);
  const result = await getPublicEventTeamMatchFactsBatch([
    { seasonId: a.seasonId, entryIds: [a.entryAId, a.entryAId] }, { seasonId: a.seasonId, entryIds: [a.entryBId] },
    { seasonId: b.seasonId, entryIds: [a.entryAId] }, { seasonId: test.seasonId, entryIds: [test.entryAId] },
  ]);
  expect(result.get(a.seasonId)!.size).toBe(2);
  expect(result.get(a.seasonId)!.get(a.entryAId)!.matches).toHaveLength(2);
  expect(result.get(b.seasonId)!.get(a.entryAId)!.matches).toEqual([]);
  expect(result.get(test.seasonId)!.get(test.entryAId)!.matches).toEqual([]);
  expect((await getPublicEventTeamMatchSummary(a.seasonId, [a.entryAId, a.entryBId])).records.get(a.entryAId)).toMatchObject({ played: 1, wins: 1 });
});

it("retains public opponent identity during reviewed replacement and excludes a non-public opponent", async () => {
  const a = await withFinishedBo1(), b = await withFinishedBo1();
  await db.update(schema.competitionEntries).set({ registrationStatus: "submitted" }).where(eq(schema.competitionEntries.id, a.entryBId));
  await db.update(schema.competitionEntries).set({ registrationStatus: "rejected" }).where(eq(schema.competitionEntries.id, b.entryBId));
  const result = await getPublicEventTeamMatchFactsBatch([{ seasonId: a.seasonId, entryIds: [a.entryAId] }, { seasonId: b.seasonId, entryIds: [b.entryAId] }]);
  expect(result.get(a.seasonId)!.get(a.entryAId)!.matches).toHaveLength(2);
  expect(result.get(a.seasonId)!.get(a.entryAId)!.matches[0]!.opponentName).toBe("Provider B");
  expect(result.get(b.seasonId)!.get(b.entryAId)).toEqual({ record: { played: 0, wins: 0, losses: 0, winRate: "—" }, matches: [] });
  // Replacement review retains the actual frozen approved source; do not
  // manufacture a state forbidden by the EventRoster source constraint.
  const [entry] = await db.select({ approved: schema.competitionEntries.approvedRosterRevisionId }).from(schema.competitionEntries).where(eq(schema.competitionEntries.id, a.entryBId));
  const [revision] = await db.select({ status: schema.competitionEntryRosterRevisions.status }).from(schema.competitionEntryRosterRevisions).where(eq(schema.competitionEntryRosterRevisions.id, entry!.approved!));
  expect(revision!.status).toBe("approved");
});

it("preserves forfeit series scores and omitted-result emptiness through the display-score owner", async () => {
  const f = await withFinishedBo1();
  const [forfeit, omitted] = await db.insert(schema.matches).values([
    { seasonId: f.seasonId, entryAId: f.entryAId, entryBId: f.entryBId, stage: "history", format: "bo1", status: "finished", isForfeit: true, scoreA: 0, scoreB: 1, completedAt: new Date("2026-02-01") },
    { seasonId: f.seasonId, entryAId: f.entryAId, entryBId: f.entryBId, stage: "history", format: "bo1", status: "finished", resultDisposition: "omitted", completedAt: new Date("2026-03-01") },
  ]).returning();
  const facts = (await getPublicEventTeamMatchFactsBatch([{ seasonId: f.seasonId, entryIds: [f.entryAId] }])).get(f.seasonId)!.get(f.entryAId)!;
  expect(facts.record).toEqual({ played: 2, wins: 1, losses: 1, winRate: "50%" });
  expect(facts.matches.find(m => m.id === forfeit!.id)).toMatchObject({ displayScore: { own: 0, opponent: 1 }, isForfeit: true });
  expect(facts.matches.find(m => m.id === omitted!.id)).toMatchObject({ displayScore: { own: null, opponent: null }, ownScore: null, opponentScore: null });
});

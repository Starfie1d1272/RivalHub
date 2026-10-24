import { randomUUID } from "node:crypto";
import type { Pool, QueryResult } from "pg";
import { performance } from "node:perf_hooks";
import { and, eq, inArray } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { seedFixture } from "./harness/mizar";
import { getPublicSeasonResults, getPublicSeasonResultSummaries } from "@/lib/seasons/public-results";
import { getLatestSeasonAnnouncement, getPublicAnnouncementPage, listPublicAnnouncements } from "@/lib/announcements/read-model";
import { loadPublicMatchRefreshToken } from "@/lib/matches/public-refresh";
import { getPublicCommunityAwardBoardData } from "@/lib/community-awards/data";

vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));

// Real queries protect scope, canonical vacancy and BO1 facts. The full reader
// is a conservative comparison, not a mock of PostgreSQL or a production LCP.
it("keeps compact results equivalent while batching history and excluding non-consumed data", async () => {
  const baselineModule = process.env.RIVALHUB_PUBLIC_RESULTS_BASELINE;
  const fullReader = baselineModule
    ? ((await import(baselineModule)) as { getPublicSeasonResults: typeof getPublicSeasonResults }).getPublicSeasonResults
    : getPublicSeasonResults;
  const a = await seedFixture();
  const b = await seedFixture();
  const seasons = await db.select().from(schema.seasons).where(inArray(schema.seasons.id, [a.seasonId, b.seasonId]));
  await db.insert(schema.tournamentHonors).values(seasons.flatMap(season => Array.from({ length: 12 }, (_, i) => ({
    seasonId: season.id, clientRequestId: randomUUID(), honorKey: `manual:${i}`, type: "manual_award" as const,
    label: `历史荣誉-${i}`, basis: "manual" as const, entryId: season.id === a.seasonId ? a.entryAId : b.entryAId, awardedBy: "fixture",
  }))));
  const [champion] = await db.insert(schema.tournamentHonors).values({ seasonId: a.seasonId, clientRequestId: randomUUID(), honorKey: "champion", type: "champion", label: "冠军", basis: "manual", entryId: a.entryAId, awardedBy: "fixture" }).returning();
  await db.insert(schema.matches).values([a, b].flatMap(f => Array.from({ length: 20 }, (_, i) => ({
    seasonId: f.seasonId, entryAId: f.entryAId, entryBId: f.entryBId, stage: "history", format: "bo1" as const,
    status: "finished" as const, isForfeit: true, scoreA: 1, scoreB: 0, completedAt: new Date(1700000000000 + i * 1000),
  }))));
  const compact = (full: Awaited<ReturnType<typeof getPublicSeasonResults>>) => ({ champion: full.champion, championVacant: full.championVacant, final: full.final, completedAt: full.completedAt, finishedMatches: full.finishedMatches });
  const full = await Promise.all(seasons.map(fullReader));
  const summaries = await getPublicSeasonResultSummaries(seasons);
  seasons.forEach((season, index) => expect(summaries.get(season.id)).toEqual(compact(full[index]!)));
  expect(summaries.get(a.seasonId)?.champion?.entryId).toBe(a.entryAId);
  await db.update(schema.tournamentHonors).set({ state: "revoked", revokedAt: new Date(), revokedBy: "fixture", revocationReason: "fixture" }).where(eq(schema.tournamentHonors.id, champion!.id));
  expect((await getPublicSeasonResultSummaries(seasons)).get(a.seasonId)).toMatchObject({ champion: null, championVacant: true });
  expect(await getPublicSeasonResultSummaries([])).toEqual(new Map());

  const runs: unknown[] = [];
  const pool = (db as typeof db & { $client: Pool }).$client;
  async function measure(work: () => Promise<unknown>) {
    const original = pool.query;
    const footprint = { queries: 0, rows: 0, jsonBytes: 0, durationMs: 0 };
    pool.query = ((...args: unknown[]) => Promise.resolve(Reflect.apply(original, pool, args) as Promise<QueryResult>).then(value => {
      if (value.command === "SELECT") { footprint.queries++; footprint.rows += value.rows.length; footprint.jsonBytes += Buffer.byteLength(JSON.stringify(value.rows)); }
      return value;
    })) as typeof pool.query;
    const start = performance.now();
    try { await work(); } finally { footprint.durationMs = performance.now() - start; pool.query = original; }
    return footprint;
  }
  for (let run = 0; run < 10; run++) {
    const before = () => measure(() => Promise.all(seasons.map(fullReader)));
    const after = () => measure(() => getPublicSeasonResultSummaries(seasons));
    const [first, second] = run % 2 ? [after, before] : [before, after];
    const x = await first(), y = await second();
    const baseline = run % 2 ? y : x, candidate = run % 2 ? x : y;
    expect(candidate.queries).toBeLessThan(baseline.queries);
    expect(candidate.rows).toBeLessThan(baseline.rows);
    expect(candidate.jsonBytes).toBeLessThan(baseline.jsonBytes);
    runs.push({ run, baseline, candidate });
  }
  console.info("PUBLIC_DIRECTORY_AB", JSON.stringify({ comparison: baselineModule ? "exact git baseline module vs compact batch" : "full results vs compact batch using current canonical rules", seasons: 2, honorsPerSeason: 12, finishedMatchesPerSeason: 20, runs }));
});

it("bounds announcement history and latest reads without leaking drafts or losing full bodies", async () => {
  const f = await seedFixture();
  const at = new Date("2026-10-20T00:00:00Z");
  await db.insert(schema.announcements).values(Array.from({ length: 25 }, (_, i) => ({
    scope: "season" as const, seasonId: f.seasonId, type: "notice" as const, title: `公告 ${i}`, body: "完整正文".repeat(100),
    status: "published" as const, publishedAt: at, updatedAt: at,
  })));
  const full = await listPublicAnnouncements(f.seasonId);
  const first = await getPublicAnnouncementPage(f.seasonId, 1), second = await getPublicAnnouncementPage(f.seasonId, 2);
  expect(first.hasNext).toBe(true); expect(second.hasNext).toBe(false);
  expect([...first.announcements, ...second.announcements]).toEqual(full);
  expect(await getLatestSeasonAnnouncement(f.seasonId)).toEqual(full[0]);
  await db.update(schema.seasons).set({ status: "draft" }).where(eq(schema.seasons.id, f.seasonId));
  expect((await getPublicAnnouncementPage(f.seasonId, 1)).announcements).toEqual([]);
  expect(await getLatestSeasonAnnouncement(f.seasonId)).toBeNull();
});

it("detects scoped map/correction and roster facts while idle tokens stay stable", async () => {
  const f = await seedFixture();
  const token = () => loadPublicMatchRefreshToken(f.seasonId, { matchId: f.matchId });
  const original = await token();
  expect(await token()).toBe(original);
  expect(original).toMatch(/^[a-f0-9]{32}$/);
  await db.update(schema.matchMaps).set({ mapName: "de_nuke" }).where(eq(schema.matchMaps.id, f.mapTwoId));
  const changed = await token(); expect(changed).not.toBe(original);
  await db.update(schema.matchMaps).set({ mapName: "de_inferno" }).where(eq(schema.matchMaps.id, f.mapTwoId));
  expect(await token()).not.toBe(changed);
  const [roster] = await db.select().from(schema.matchRosters).where(and(eq(schema.matchRosters.matchId, f.matchId), eq(schema.matchRosters.entryId, f.entryAId)));
  const beforeRoster = await token();
  await db.update(schema.matchRosters).set({ updatedAt: new Date() }).where(eq(schema.matchRosters.id, roster!.id));
  expect(await token()).not.toBe(beforeRoster);
  const stage = await loadPublicMatchRefreshToken(f.seasonId, { stage: "not-created" });
  expect(stage).toMatch(/^[a-f0-9]{32}$/);
  const publicBoard = await getPublicCommunityAwardBoardData(db, { seasonId: f.seasonId, currentUserId: null, stagePlan: [] });
  expect(publicBoard).toMatchObject({ candidates: [], matches: [] });
});

it("reuses Play-in facts only inside the frozen run and event scope", async () => {
  const { loadQualificationSwissStageReadModel } = await import("@/lib/matches/qualification-stage-read-model");
  const { withDisplayScores } = await import("@/lib/matches/display-score-data");
  const f = await seedFixture();
  const [run] = await db.insert(schema.competitionQualificationRuns).values({
    seasonId: f.seasonId, format: "short_swiss_2w2l", targetEntrantCount: 1, candidateCount: 2,
    directEntryCount: 0, playInEntryCount: 2, qualifierCount: 1, configuredBy: "fixture",
  }).returning();
  await db.insert(schema.competitionQualificationEntrants).values([f.entryAId, f.entryBId].map((id, i) => ({
    runId: run!.id, seasonId: f.seasonId, competitionEntryId: id, preliminarySeed: i + 1,
  })));
  const [match] = await db.insert(schema.matches).values({ seasonId: f.seasonId, qualificationRunId: run!.id,
    entryAId: f.entryAId, entryBId: f.entryBId, stage: "play-in", round: 1, format: "bo1",
  }).returning();
  const displayed = await withDisplayScores([match!]);
  const direct = await loadQualificationSwissStageReadModel(f.seasonId);
  expect(direct).not.toBeNull();
  expect(await loadQualificationSwissStageReadModel(f.seasonId, { run: run!, displayedMatches: displayed })).toEqual(direct);
  expect(await loadQualificationSwissStageReadModel(randomUUID(), { run: run!, displayedMatches: displayed })).toBeNull();
  const unrelated = { ...displayed[0]!, id: randomUUID(), seasonId: randomUUID() };
  expect(await loadQualificationSwissStageReadModel(f.seasonId, { run: run!, displayedMatches: [...displayed, unrelated] })).toEqual(direct);
});

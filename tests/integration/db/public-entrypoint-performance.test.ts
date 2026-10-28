import { randomUUID } from "node:crypto";
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
  const full = await Promise.all(seasons.map(getPublicSeasonResults));
  const summaries = await getPublicSeasonResultSummaries(seasons);
  seasons.forEach((season, index) => expect(summaries.get(season.id)).toEqual(compact(full[index]!)));
  expect(summaries.get(a.seasonId)?.champion?.entryId).toBe(a.entryAId);
  await db.update(schema.tournamentHonors).set({ state: "revoked", revokedAt: new Date(), revokedBy: "fixture", revocationReason: "fixture" }).where(eq(schema.tournamentHonors.id, champion!.id));
  expect((await getPublicSeasonResultSummaries(seasons)).get(a.seasonId)).toMatchObject({ champion: null, championVacant: true });
  expect(await getPublicSeasonResultSummaries([])).toEqual(new Map());


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
  // A real commit in the read gap yields a new token while the captured page
  // facts remain old. The component bootstrap test requires a refresh here.
  const captured = (await db.query.matches.findFirst({ where: eq(schema.matches.id, f.matchId) }))!;
  const moved = new Date(captured.scheduledAt!.getTime() + 60_000);
  await db.update(schema.matches).set({ scheduledAt: moved }).where(eq(schema.matches.id, f.matchId));
  expect(await token()).not.toBe(original);
  expect(captured.scheduledAt).not.toEqual(moved);
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

it("keeps administrator summary counts and direct details scoped without returning list bodies", async () => {
  const { listAnnouncementAdminSummaries, getAnnouncementForAdmin } = await import("@/lib/announcements/read-model");
  const { listSeasonPublicInfoAdminSummaries, getSeasonPublicInfoAdmin } = await import("@/lib/season-public-info/read-model");
  const f = await seedFixture(), other = await seedFixture();
  await db.insert(schema.communityGroups).values([{ seasonId: f.seasonId, label: "active", groupNumber: "1" }, { seasonId: f.seasonId, label: "closed", status: "closed" }]);
  await db.insert(schema.seasonContacts).values({ seasonId: f.seasonId, label: "public contact", value: "fixture" });
  await db.insert(schema.communityGroups).values({ seasonId: other.seasonId, label: "foreign", groupNumber: "2" });
  const summaries = await listSeasonPublicInfoAdminSummaries("season_admin", [f.seasonId]);
  expect(summaries).toHaveLength(1);
  expect(summaries[0]).toMatchObject({ season: { id: f.seasonId }, groupCount: 2, contactCount: 1 });
  expect(await listSeasonPublicInfoAdminSummaries("season_admin", [])).toEqual([]);
  expect((await getSeasonPublicInfoAdmin(f.seasonId, "season_admin", [f.seasonId]))?.groups).toHaveLength(2);
  expect(await getSeasonPublicInfoAdmin(other.seasonId, "season_admin", [f.seasonId])).toBeNull();
  const [draft] = await db.insert(schema.announcements).values({ scope: "season", seasonId: f.seasonId, title: "admin draft", body: "full detail body" }).returning();
  await db.insert(schema.announcements).values({ scope: "season", seasonId: other.seasonId, title: "foreign draft", body: "foreign body" });
  const access = { role: "season_admin" as const, seasonIds: [f.seasonId] };
  const page = await listAnnouncementAdminSummaries({ ...access, pageSize: 1 });
  expect(page).toMatchObject({ total: 1, page: 1, pageSize: 1 });
  expect(page.items[0]).toMatchObject({ id: draft!.id, status: "draft" });
  expect(page.items[0]).not.toHaveProperty("body");
  expect((await getAnnouncementForAdmin(draft!.id, access))?.body).toBe("full detail body");
  expect(await getAnnouncementForAdmin(draft!.id, { ...access, seasonId: other.seasonId })).toBeNull();
  expect(await getAnnouncementForAdmin(draft!.id, { role: "season_admin", seasonIds: [] })).toBeNull();
});

it("keeps mismatch warnings for unowned Play-in matches even when a qualification run exists", async () => {
  const { hasUnconfiguredPublicScheduleMatches } = await import("@/lib/matches/schedule-read");
  const f = await seedFixture();
  const match = (await db.query.matches.findFirst({ where: eq(schema.matches.id, f.matchId) }))!;
  expect(await hasUnconfiguredPublicScheduleMatches(f.seasonId, [match.stage!])).toBe(false);
  const [run] = await db.insert(schema.competitionQualificationRuns).values({ seasonId: f.seasonId, format: "direct_bo3", targetEntrantCount: 1,
    candidateCount: 2, directEntryCount: 0, playInEntryCount: 2, qualifierCount: 1, configuredBy: "fixture" }).returning();
  const [playIn] = await db.insert(schema.matches).values({ seasonId: f.seasonId, entryAId: f.entryAId, entryBId: f.entryBId, stage: "play-in", format: "bo3" }).returning();
  expect(await hasUnconfiguredPublicScheduleMatches(f.seasonId, [match.stage!], run!.id)).toBe(true);
  await db.update(schema.matches).set({ qualificationRunId: run!.id }).where(eq(schema.matches.id, playIn!.id));
  expect(await hasUnconfiguredPublicScheduleMatches(f.seasonId, [match.stage!], run!.id)).toBe(false);
  expect(await hasUnconfiguredPublicScheduleMatches(f.seasonId, [match.stage!])).toBe(true);
});

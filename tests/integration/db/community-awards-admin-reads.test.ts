import { randomUUID } from "node:crypto";
import type { Pool, QueryResult } from "pg";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { getAdminCommunityAwardBoardData, getAdminCommunityAwardBoardSummaries, getAdminCommunityAwardDetail, getCommunityAwardFormOptions } from "@/lib/community-awards/data";
import { seedFixture } from "./harness/mizar";
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

async function fixture() {
  const f = await seedFixture();
  const [entry] = await db.select({ userId: schema.competitionEntries.representativeUserId }).from(schema.competitionEntries).where(eq(schema.competitionEntries.id, f.entryAId));
  const userId = entry!.userId;
  const awards = await db.insert(schema.communityAwards).values([
    { seasonId: f.seasonId, submittedByUserId: userId, name: "Event verified", condition: "Long condition".repeat(100), prize: "Prize", settlementPolicy: "event_verified" },
    { seasonId: f.seasonId, submittedByUserId: userId, name: "Season complete", condition: "Condition", prize: "Prize", settlementPolicy: "season_complete" },
    { seasonId: f.seasonId, submittedByUserId: userId, name: "Play-in complete", condition: "Condition", prize: "Prize", settlementPolicy: "play_in_complete" },
    { seasonId: f.seasonId, submittedByUserId: userId, name: "Stage complete", condition: "Condition", prize: "Prize", settlementPolicy: "stage_complete", settlementStageKey: "stage1" },
  ]).returning();
  await db.insert(schema.communityAwardEvidence).values(Array.from({ length: 20 }, (_, i) => ({ awardId: awards[0]!.id,
    submittedByUserId: userId, candidateUserId: userId, matchId: f.matchId, explanation: "Private evidence".repeat(200),
    ...(i === 0 ? { verificationStatus: "eligible" as const, verifiedByUserId: userId, verifiedAt: new Date(), verificationNote: "verified" } : {}),
  })));
  // Unreferenced matches must not be queried just to label one award's evidence.
  await db.insert(schema.matches).values(Array.from({ length: 12 }, () => ({ seasonId: f.seasonId, entryAId: f.entryAId, entryBId: f.entryBId, stage: "unused", format: "bo3" as const })));
  return { ...f, userId, awards };
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

it("keeps global readiness equivalent without transporting evidence bodies or form options", async () => {
  const f = await fixture();
  const full = await measure(() => getAdminCommunityAwardBoardData(db, { seasonId: f.seasonId, stagePlan: [] }));
  const summary = await measure(() => getAdminCommunityAwardBoardSummaries(db, { seasonId: f.seasonId }));
  expect(summary.data.awards.map(a => a.id)).toEqual(full.data.awards.map(a => a.id));
  for (const award of summary.data.awards) {
    const old = full.data.awards.find(row => row.id === award.id)!;
    expect(award).toMatchObject({ settlementReady: old.settlementReady, nonAwardingReady: old.nonAwardingReady, recipients: old.recipients,
      resultVersion: old.resultVersion, submitterName: old.submitterName, submitterPlayerUserId: old.submitterPlayerUserId });
    expect(award).not.toHaveProperty("evidence"); expect(award).not.toHaveProperty("condition");
    expect(award).not.toHaveProperty("reviewNote");
  }
  expect(summary.data).not.toHaveProperty("candidates"); expect(summary.data).not.toHaveProperty("matches");
  expect(summary.data.awards[0]).toMatchObject({ evidenceCount: 20, eligibleEvidenceCount: 1, settlementReady: true, nonAwardingReady: false });
  expect(summary.data.awards.slice(1).every(a => !a.settlementReady)).toBe(true);
  expect(summary.footprint.queries).toBeLessThan(full.footprint.queries);
  expect(summary.footprint.rows).toBeLessThan(full.footprint.rows);
  expect(summary.footprint.jsonBytes).toBeLessThan(full.footprint.jsonBytes);
  console.info("AWARD_ADMIN_SUMMARY_AB", JSON.stringify({ baseline: full.footprint, candidate: summary.footprint }));
  await db.update(schema.seasons).set({ status: "finished" }).where(eq(schema.seasons.id, f.seasonId));
  expect((await getAdminCommunityAwardBoardSummaries(db, { seasonId: f.seasonId })).awards[1]).toMatchObject({ settlementReady: true, nonAwardingReady: true });
});

it("loads one same-season detail, preserves identities/labels and leaves candidate options separate", async () => {
  const f = await fixture(), other = await fixture();
  const full = await getAdminCommunityAwardBoardData(db, { seasonId: f.seasonId, stagePlan: [] });
  const detail = await measure(() => getAdminCommunityAwardDetail(db, { seasonId: f.seasonId, awardId: f.awards[0]!.id, stagePlan: [] }));
  expect(detail.data).toEqual(full.awards[0]);
  expect(detail.data!.evidence).toHaveLength(20);
  expect(detail.data!.evidence![0]).toMatchObject({ submitterPlayerUserId: f.userId, candidatePlayerUserId: f.userId });
  expect(detail.data!.evidence![0]!.matchLabel).toBeTruthy();
  expect(await getAdminCommunityAwardDetail(db, { seasonId: other.seasonId, awardId: f.awards[0]!.id, stagePlan: [] })).toBeNull();
  expect(await getAdminCommunityAwardDetail(db, { seasonId: f.seasonId, awardId: randomUUID(), stagePlan: [] })).toBeNull();
  const empty = await getAdminCommunityAwardDetail(db, { seasonId: f.seasonId, awardId: f.awards[1]!.id, stagePlan: [] });
  expect(empty!.evidence).toEqual([]);
  const options = await getCommunityAwardFormOptions(db, f.seasonId, []);
  expect(options.candidates.some(c => c.id === f.userId)).toBe(true);
  expect(options.matches).toHaveLength(13);
});

it("uses frozen global Major and Play-in completion instead of the visible match subset", async () => {
  const f = await fixture();
  await db.update(schema.seasons).set({ competitionTemplate: "major", status: "registration", stagePlan: [] }).where(eq(schema.seasons.id, f.seasonId));
  const stage = { key: "stage1", name: "Frozen stage", type: "swiss", teamCount: 16, matchFormat: "bo1", finalFormat: null, advanceTiers: [] };
  const [run] = await db.insert(schema.majorStageRuns).values({ seasonId: f.seasonId, stageKey: "stage1", finalizedRound: 4, startedBy: "fixture",
    ruleSnapshot: { version: 4, rosterRules: { minTeamSize: 5, maxTeamSize: 9, starterCount: 5 }, affiliationRules: [], competitiveProfile: null, frozenCompetitiveFacts: [], runOptions: {}, stagePlan: [stage] },
  }).returning();
  await db.insert(schema.competitionQualificationRuns).values({ seasonId: f.seasonId, format: "direct_bo3", candidateCount: 3, targetEntrantCount: 2,
    directEntryCount: 1, playInEntryCount: 2, qualifierCount: 1, configuredBy: "fixture", startedBy: "fixture", startedAt: new Date(), completedAt: new Date() });
  const before = await getAdminCommunityAwardBoardSummaries(db, { seasonId: f.seasonId });
  expect(before.awards.find(a => a.id === f.awards[2]!.id)!.settlementReady).toBe(true);
  expect(before.awards.find(a => a.id === f.awards[3]!.id)!.settlementReady).toBe(false);
  expect(before.awards.find(a => a.id === f.awards[1]!.id)!.settlementReady).toBe(false);
  expect(before.stages).toContainEqual({ key: "stage1", name: "Frozen stage" });
  await db.update(schema.majorStageRuns).set({ finalizedRound: 5 }).where(eq(schema.majorStageRuns.id, run!.id));
  const after = await getAdminCommunityAwardBoardSummaries(db, { seasonId: f.seasonId });
  expect(after.awards.find(a => a.id === f.awards[3]!.id)!.settlementReady).toBe(true);
  const full = await getAdminCommunityAwardBoardData(db, { seasonId: f.seasonId, stagePlan: [] });
  for (const award of after.awards) expect(award.settlementReady).toBe(full.awards.find(a => a.id === award.id)!.settlementReady);
});

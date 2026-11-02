/**
 * Real PostgreSQL protects the shared match lock, timeout safety, participant
 * permission and Play-in discovery; mocked DB/component tests cannot prove these.
 * Only auth transport and cache invalidation are substituted.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { seedFixture } from "./harness/mizar";
import { runMatchTimeAutoAwardCron } from "@/lib/matches/time-auto-award";
import { loadMyCompetitionContexts, loadMyCompetitionNextMatches } from "@/lib/my/competitions";
import { transferCompetitionEntryRepresentativeInTx } from "@/lib/competition-entries/commands";
import { getMatchTimeProposalViews } from "@/lib/matches/time-proposals";
import { loadAdminMatchOperations } from "@/lib/admin/matches/operations";
import { createLocalPool } from "./harness/database";

const auth = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/auth/session", () => ({
  requireAuth: async () => ({ userId: auth.userId }),
  getUserSession: async () => ({ userId: auth.userId }),
  requireSeasonAdmin: async () => ({ userId: auth.userId }),
}));
vi.mock("@/lib/revalidation", () => ({ revalidateMatchPaths: vi.fn() }));
import { proposeMatchTime, respondToTimeProposal } from "@/actions/matches/scheduling";
import { getSeasonPersonalNextStep } from "@/lib/seasons/public-next-step";

const hour = 3_600_000;

it.each(["match", "coverage"])("rechecks notice and rolls back resources after actually waiting for the %s lock", async (lock) => {
  const fixture = await seedFixture({ matchStatus: "scheduled" });
  await db.update(schema.matches).set({ scheduledAt: null }).where(eq(schema.matches.id, fixture.matchId));
  const a = (await db.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, fixture.entryAId) }))!;
  let current = new Date();
  const [proposal] = await db.insert(schema.matchTimeProposals).values({ matchId: fixture.matchId, proposedBy: a.representativeUserId,
    createdAt: new Date(current.getTime() - 25 * hour), proposedTime: new Date(current.getTime() + 2 * hour + 1_000),
  }).returning();
  const [slot] = await db.insert(schema.officialCoverageSlots).values({ seasonId: fixture.seasonId, startsAt: current,
    endsAt: new Date(current.getTime() + 4 * hour), capacity: 1,
  }).returning();
  const [hold] = await db.insert(schema.coverageHolds).values({ slotId: slot.id, matchId: fixture.matchId,
    proposedScheduledAt: proposal.proposedTime, expiresAt: new Date(current.getTime() + hour),
  }).returning();
  const pool = createLocalPool({ max: 2 });
  const blocker = await pool.connect();
  let work: ReturnType<typeof runMatchTimeAutoAwardCron> | undefined;
  try {
    await blocker.query("BEGIN");
    const pid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await blocker.query(lock === "match" ? "SELECT id FROM matches WHERE id = $1 FOR UPDATE" : "SELECT id FROM official_coverage_slots WHERE id = $1 FOR UPDATE", [lock === "match" ? fixture.matchId : slot.id]);
    work = runMatchTimeAutoAwardCron(() => current);
    await vi.waitFor(async () => {
      const blocked = await pool.query("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked", [pid]);
      expect(blocked.rows[0].blocked).toBe(true);
    });
    current = new Date(current.getTime() + 2_000);
    await blocker.query("COMMIT");
    await work;
    expect((await db.query.matches.findFirst({ where: eq(schema.matches.id, fixture.matchId) }))?.scheduledAt).toBeNull();
    expect(await db.query.matchTimeProposals.findFirst({ where: eq(schema.matchTimeProposals.id, proposal.id) })).toMatchObject({ status: "pending", resolution: null });
    expect(await db.query.auditLogs.findMany({ where: and(eq(schema.auditLogs.targetId, fixture.matchId), eq(schema.auditLogs.action, "match.auto_accept_proposal_timeout")) })).toHaveLength(0);
    expect((await db.query.coverageHolds.findFirst({ where: eq(schema.coverageHolds.id, hold.id) }))?.releasedAt).toBeNull();
    expect(await db.query.coverageAllocations.findMany({ where: eq(schema.coverageAllocations.matchId, fixture.matchId) })).toHaveLength(0);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await work;
    await pool.end();
  }
});

it.each([
  { reschedule: false, legacy: false }, { reschedule: true, legacy: false },
  { reschedule: false, legacy: true }, { reschedule: true, legacy: true },
])("keeps proposal ownership after handover across commands and projections ($reschedule, legacy=$legacy)", async ({ reschedule, legacy }) => {
  const fixture = await seedFixture({ matchStatus: "scheduled" });
  const originalTime = reschedule ? new Date(Date.now() + 3 * hour) : null;
  await db.update(schema.matches).set({ scheduledAt: originalTime }).where(eq(schema.matches.id, fixture.matchId));
  const a = (await db.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, fixture.entryAId) }))!;
  const b = (await db.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, fixture.entryBId) }))!;
  const successor = (await db.query.competitionEntryParticipants.findFirst({ where: and(eq(schema.competitionEntryParticipants.entryId, a.id), ne(schema.competitionEntryParticipants.userId, a.representativeUserId)) }))!;
  auth.userId = a.representativeUserId;
  const result = await proposeMatchTime(fixture.matchId, new Date(Date.now() + hour));
  if (!result.success) throw new Error(result.error.message);
  if (legacy) await db.update(schema.matchTimeProposals).set({ proposedByEntryId: null }).where(eq(schema.matchTimeProposals.id, result.data.proposalId));
  await db.transaction(tx => transferCompetitionEntryRepresentativeInTx(tx, { entryId: a.id, userId: a.representativeUserId, toUserId: successor.userId, actorId: a.representativeUserId }));
  if (!legacy) {
    // The explicit side must remain authoritative even at a timestamp tie with
    // a later handover; mutable representatives and time ordering cannot own it.
    const change = (await db.select().from(schema.competitionEntryRepresentativeChanges).where(eq(schema.competitionEntryRepresentativeChanges.entryId, a.id)).orderBy(desc(schema.competitionEntryRepresentativeChanges.changedAt)).limit(1))[0]!;
    await db.update(schema.matchTimeProposals).set({ createdAt: change.changedAt }).where(eq(schema.matchTimeProposals.id, result.data.proposalId));
  }
  auth.userId = successor.userId;
  expect((await respondToTimeProposal(result.data.proposalId, "accept")).success).toBe(false);
  expect((await respondToTimeProposal(result.data.proposalId, "reject", "本队不能拒绝")).success).toBe(false);
  expect((await db.query.matches.findFirst({ where: eq(schema.matches.id, fixture.matchId) }))?.scheduledAt).toEqual(originalTime);
  expect((await getMatchTimeProposalViews(fixture.matchId, successor.userId))[0]?.isMine).toBe(true);
  expect((await loadMyCompetitionNextMatches(successor.userId)).get(a.id)?.pendingIsMine).toBe(true);
  const operations = await loadAdminMatchOperations(fixture.seasonId, { currentMatches: [], nextMatch: null, claimableMatches: [], claimableCount: 0, byMatchId: {} });
  expect(operations[0]?.awaitingEntryIds).toEqual([b.id]);
  auth.userId = a.representativeUserId;
  expect((await proposeMatchTime(fixture.matchId, new Date(Date.now() + hour))).success).toBe(false);
  auth.userId = b.representativeUserId;
  expect((await respondToTimeProposal(result.data.proposalId, "accept")).success).toBe(true);
});

it("rejects legacy proposals with no provable side without changing the schedule or audit", async () => {
  const fixture = await seedFixture({ matchStatus: "scheduled" });
  const entries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, fixture.seasonId));
  const a = entries.find(entry => entry.id === fixture.entryAId)!;
  const b = entries.find(entry => entry.id === fixture.entryBId)!;
  const before = (await db.query.matches.findFirst({ where: eq(schema.matches.id, fixture.matchId) }))!;
  const [proposal] = await db.insert(schema.matchTimeProposals).values({ matchId: fixture.matchId, proposedBy: a.representativeUserId,
    createdAt: new Date(0), proposedTime: new Date(Date.now() + hour),
  }).returning();
  auth.userId = b.representativeUserId;
  expect(await respondToTimeProposal(proposal.id, "accept")).toMatchObject({ success: false, error: { code: "FORBIDDEN" } });
  expect(await db.query.matches.findFirst({ where: eq(schema.matches.id, fixture.matchId) })).toEqual(before);
  expect((await db.query.matchTimeProposals.findFirst({ where: eq(schema.matchTimeProposals.id, proposal.id) }))?.status).toBe("pending");
  expect(await db.query.auditLogs.findMany({ where: eq(schema.auditLogs.targetId, proposal.id) })).toHaveLength(0);
});

it("requires a full response window and safe runtime notice, preserves reschedules, and is idempotent under concurrency", async () => {
  const fixture = await seedFixture({ matchStatus: "scheduled" });
  const entry = (await db.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, fixture.entryAId) }))!;
  const now = new Date();
  async function scenario(age: number, notice: number, scheduledAt: Date | null = null, deadline = new Date(now.getTime() + 4 * hour)) {
    const [match] = await db.insert(schema.matches).values({
      seasonId: fixture.seasonId, entryAId: fixture.entryAId, entryBId: fixture.entryBId,
      stage: "play-in", status: "scheduled", scheduledAt, completionDeadline: deadline,
    }).returning();
    const [proposal] = await db.insert(schema.matchTimeProposals).values({
      matchId: match.id, proposedBy: entry.representativeUserId,
      createdAt: new Date(now.getTime() - age),
      proposedTime: new Date(now.getTime() + notice),
    }).returning();
    return { match, proposal };
  }
  const early = await scenario(24 * hour - 1, 3 * hour);
  const exact = await scenario(24 * hour, 2 * hour);
  const short = await scenario(24 * hour, 2 * hour - 1);
  const past = await scenario(25 * hour, -1);
  const delayed = await scenario(25 * hour, hour);
  const outside = await scenario(25 * hour, 3 * hour, null, new Date(now.getTime() + hour));
  const reschedule = await scenario(25 * hour, 3 * hour, new Date(now.getTime() + hour));
  // Old deadline-24h path would have accepted early, despite incomplete response time.
  await Promise.all([runMatchTimeAutoAwardCron(() => now), runMatchTimeAutoAwardCron(() => now)]);
  for (const item of [early, short, delayed, past, outside]) {
    expect((await db.query.matches.findFirst({ where: eq(schema.matches.id, item.match.id) }))?.scheduledAt).toBeNull();
  }
  expect(await db.query.matches.findFirst({ where: eq(schema.matches.id, exact.match.id) })).toMatchObject({ scheduledAt: exact.proposal.proposedTime });
  expect(await db.query.matchTimeProposals.findFirst({ where: eq(schema.matchTimeProposals.id, exact.proposal.id) })).toMatchObject({ status: "accepted", resolution: "auto_timeout" });
  expect(await db.query.matches.findFirst({ where: eq(schema.matches.id, reschedule.match.id) })).toMatchObject({ scheduledAt: reschedule.match.scheduledAt });
  expect(await db.query.matchTimeProposals.findFirst({ where: eq(schema.matchTimeProposals.id, reschedule.proposal.id) })).toMatchObject({ status: "pending" });
  expect(await db.query.matchTimeProposals.findFirst({ where: eq(schema.matchTimeProposals.id, past.proposal.id) })).toMatchObject({ status: "expired" });
  expect(await db.query.auditLogs.findMany({ where: and(eq(schema.auditLogs.targetId, exact.match.id), eq(schema.auditLogs.action, "match.auto_accept_proposal_timeout")) })).toHaveLength(1);
});

it("allows short-notice mutual consent without a lineup, protects permissions and discovers registration Play-in tasks", async () => {
  const fixture = await seedFixture({ matchStatus: "scheduled", freezeEventRoster: true });
  const a = (await db.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, fixture.entryAId) }))!;
  const b = (await db.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, fixture.entryBId) }))!;
  // Captain outside the player projection still owns this event's scheduling.
  const captainId = randomUUID();
  await db.insert(schema.users).values({ id: captainId, email: captainId + "@local.test" });
  await db.transaction(async tx => {
    await tx.insert(schema.competitionEntryRepresentativeChanges).values({
      entryId: a.id, fromUserId: a.representativeUserId, toUserId: captainId, changedByActorId: "integration-test",
    });
    await tx.update(schema.competitionEntries).set({ representativeUserId: captainId }).where(eq(schema.competitionEntries.id, a.id));
  });
  await db.update(schema.seasons).set({ status: "registration" }).where(eq(schema.seasons.id, fixture.seasonId));
  await db.update(schema.matches).set({ scheduledAt: null, stage: "play-in", completionDeadline: new Date(Date.now() + hour) }).where(eq(schema.matches.id, fixture.matchId));
  await db.delete(schema.matchRosters).where(eq(schema.matchRosters.matchId, fixture.matchId));
  const [run] = await db.insert(schema.competitionQualificationRuns).values({
    seasonId: fixture.seasonId, format: "direct_bo3", targetEntrantCount: 1,
    candidateCount: 2, directEntryCount: 0, playInEntryCount: 2, qualifierCount: 1,
    configuredBy: captainId, startedBy: captainId, startedAt: new Date(),
  }).returning();
  await db.insert(schema.competitionQualificationEntrants).values([
    { runId: run.id, seasonId: fixture.seasonId, competitionEntryId: a.id, preliminarySeed: 1 },
    { runId: run.id, seasonId: fixture.seasonId, competitionEntryId: b.id, preliminarySeed: 2 },
  ]);
  await db.update(schema.matches).set({ qualificationRunId: run.id, round: 1 }).where(eq(schema.matches.id, fixture.matchId));
  auth.userId = captainId;
  const contexts = await loadMyCompetitionContexts(captainId);
  expect(contexts[0]?.primaryAction.label).toBe("发起比赛时间提议");
  const season = await db.query.seasons.findFirst({ where: eq(schema.seasons.id, fixture.seasonId) });
  expect(season).toBeTruthy();
  expect(await getSeasonPersonalNextStep(season!)).toEqual(contexts[0]?.nextMatch);
  const proposedTime = new Date(Date.now() + 30 * 60_000);
  const proposed = await proposeMatchTime(fixture.matchId, proposedTime);
  expect(proposed.success).toBe(true);
  if (!proposed.success) throw new Error("proposal failed");
  expect((await respondToTimeProposal(proposed.data.proposalId, "accept")).success).toBe(false);
  auth.userId = b.representativeUserId;
  expect((await loadMyCompetitionContexts(auth.userId))[0]?.primaryAction.label).toBe("确认比赛时间");
  expect((await respondToTimeProposal(proposed.data.proposalId, "accept")).success).toBe(true);
  expect((await respondToTimeProposal(proposed.data.proposalId, "accept")).success).toBe(false);
  expect(await db.query.matches.findFirst({ where: eq(schema.matches.id, fixture.matchId) })).toMatchObject({ scheduledAt: proposedTime });
  expect(await db.query.matchRosters.findMany({ where: eq(schema.matchRosters.matchId, fixture.matchId) })).toEqual([]);
  auth.userId = randomUUID();
  expect((await proposeMatchTime(fixture.matchId, new Date(Date.now() + 40 * 60_000))).success).toBe(false);
  expect((await loadMyCompetitionNextMatches(auth.userId)).size).toBe(0);
  await db.update(schema.matches).set({ qualificationRunId: null }).where(eq(schema.matches.id, fixture.matchId));
  // Cron still prepares legal defaults inside T-2h using the original roster owner.
  await runMatchTimeAutoAwardCron();
  expect(await db.query.matchRosters.findMany({ where: eq(schema.matchRosters.matchId, fixture.matchId) })).toHaveLength(2);
});

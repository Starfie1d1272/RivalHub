import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ userId: "", admin: true, queries: [] as string[] }));
vi.mock("@/db/client", async importOriginal => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("@/db/schema");
  return { ...actual, db: drizzle((actual.db as typeof actual.db & { $client: Pool }).$client, { schema, logger: { logQuery: query => state.queries.push(query) } }) };
});
vi.mock("@/lib/auth/session", async () => {
  const { AppError, ErrorCode } = await import("@/lib/errors");
  return { requireAuth: async () => ({ userId: state.userId }), requireSeasonAdmin: async () => {
    if (!state.admin) throw new AppError(ErrorCode.FORBIDDEN, "denied");
    return { userId: state.userId };
  }, auditActorId: (session: { userId: string }) => session.userId };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { getMatchRosterReadback } from "@/actions/matches/roster";
import { getMatchRecordingReadback } from "@/actions/postmatch";
import { getTimeProposalReadback } from "@/actions/matches/scheduling";
import { recordingReadbackVersion, rosterReadbackVersion, timeReadbackVersion } from "@/lib/matches/operation-readback";
import { seedFixture } from "./harness/mizar";

it("returns fresh scoped roster/recording/proposal content versions, denies stale authority and never writes audit", async () => {
  const f = await seedFixture({ matchStatus: "scheduled", unboundSource: true, freezeEventRoster: true });
  const [entryA] = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.id, f.entryAId));
  const [entryB] = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.id, f.entryBId));
  const actorA = entryA!.representativeUserId;
  state.userId = actorA; state.admin = false;
  const auditBefore = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.seasonId, f.seasonId));
  const roster = await getMatchRosterReadback(f.matchId, f.entryAId);
  expect(roster.success).toBe(true);
  if (!roster.success) throw new Error("fixture roster read failed");
  expect(roster.data.value.starterIds).toHaveLength(5);
  expect(roster.data.value.substituteIds).toEqual([]);
  expect(roster.data.version).toBe(await rosterReadbackVersion(f.matchId, roster.data.value));
  const rosterId = roster.data.value.rosterId!;
  await db.update(schema.matchRosterPlayers).set({ isVetoRepresentative: true }).where(eq(schema.matchRosterPlayers.eventRosterMemberId, roster.data.value.starterIds[0]!));
  const changedRoster = await getMatchRosterReadback(f.matchId, f.entryAId);
  expect(changedRoster).toMatchObject({ success: true, data: { value: { rosterId, vetoRepresentativeEventRosterMemberId: roster.data.value.starterIds[0] } } });
  if (changedRoster.success) expect(changedRoster.data.version).not.toBe(roster.data.version);
  state.userId = entryB!.representativeUserId;
  state.queries = [];
  expect(await getMatchRosterReadback(f.matchId, f.entryAId)).toMatchObject({ success: false, error: { code: "FORBIDDEN" } });
  expect(state.queries.some(query => query.includes('"match_roster_players"'))).toBe(false);

  state.userId = actorA; state.admin = true;
  const records = [
    { id: randomUUID(), commentatorUserId: actorA, title: "Original", url: "https://video.example/first" },
    { id: randomUUID(), commentatorUserId: actorA, title: "Second", url: "https://video.example/second" },
  ];
  await db.update(schema.matches).set({ recordings: records }).where(eq(schema.matches.id, f.matchId));
  const firstRecording = await getMatchRecordingReadback(f.matchId);
  expect(firstRecording).toEqual({ success: true, data: { matchId: f.matchId, value: records, version: await recordingReadbackVersion(f.matchId, records) } });
  await db.update(schema.matches).set({ recordings: [records[1]!, records[0]!] }).where(eq(schema.matches.id, f.matchId));
  const moved = await getMatchRecordingReadback(f.matchId);
  if (!moved.success || !firstRecording.success) throw new Error("fixture recording read failed");
  expect(moved.data.value.map(row => row.id)).toEqual([records[1]!.id, records[0]!.id]);
  expect(moved.data.version).not.toBe(firstRecording.data.version);
  state.admin = false; state.queries = [];
  expect(await getMatchRecordingReadback(f.matchId)).toMatchObject({ success: false, error: { code: "FORBIDDEN" } });
  expect(state.queries.some(query => query.includes('"recordings"'))).toBe(false);

  const proposalId = randomUUID();
  const proposedTime = new Date("2026-09-28T01:00:00Z");
  await db.insert(schema.matchTimeProposals).values({ id: proposalId, matchId: f.matchId, proposedBy: entryB!.representativeUserId, proposedByEntryId: f.entryBId, proposedTime });
  // Equal scheduledAt alone is insufficient: this original proposal is pending.
  await db.update(schema.matches).set({ scheduledAt: proposedTime }).where(eq(schema.matches.id, f.matchId));
  const proposal = await getTimeProposalReadback(proposalId);
  if (!proposal.success) throw new Error("fixture proposal read failed");
  expect(proposal.data.value).toMatchObject({ proposalId, status: "pending", resolution: null, scheduledAt: proposedTime.toISOString() });
  expect(proposal.data.version).not.toBe(await timeReadbackVersion(f.matchId, { ...proposal.data.value, status: "accepted", resolution: "participant_accept" }));
  await db.update(schema.matchTimeProposals).set({ status: "accepted", resolution: "participant_accept", responseAt: new Date() }).where(eq(schema.matchTimeProposals.id, proposalId));
  const accepted = await getTimeProposalReadback(proposalId);
  expect(accepted).toMatchObject({ success: true, data: { value: { proposalId, status: "accepted", resolution: "participant_accept" } } });
  if (accepted.success) expect(accepted.data.version).not.toBe(proposal.data.version);

  // Actual canonical representative transfer, not a stale client isCaptain flag.
  const [replacement] = await db.select({ userId: schema.eventRosterMembers.userId }).from(schema.eventRosterMembers)
    .innerJoin(schema.eventRosters, eq(schema.eventRosters.id, schema.eventRosterMembers.eventRosterId))
    .where(eq(schema.eventRosters.entryId, f.entryAId));
  const replacementId = replacement!.userId === actorA ? (await db.select({ userId: schema.eventRosterMembers.userId }).from(schema.eventRosterMembers)
    .innerJoin(schema.eventRosters, eq(schema.eventRosters.id, schema.eventRosterMembers.eventRosterId))
    .where(eq(schema.eventRosters.entryId, f.entryAId))).find(row => row.userId !== actorA)!.userId : replacement!.userId;
  await db.transaction(async tx => {
    await tx.update(schema.competitionEntries).set({ representativeUserId: replacementId }).where(eq(schema.competitionEntries.id, f.entryAId));
    await tx.insert(schema.competitionEntryRepresentativeChanges).values({ entryId: f.entryAId, fromUserId: actorA, toUserId: replacementId, changedByActorId: actorA });
  });
  state.queries = [];
  expect(await getTimeProposalReadback(proposalId)).toMatchObject({ success: false, error: { code: "FORBIDDEN" } });
  expect(await getMatchRosterReadback(f.matchId, f.entryAId)).toMatchObject({ success: false, error: { code: "FORBIDDEN" } });
  expect(state.queries.some(query => query.includes('"match_roster_players"'))).toBe(false);
  expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.seasonId, f.seasonId))).toEqual(auditBefore);
});

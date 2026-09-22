import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import type { TxDb } from "../../../src/db/client";
import * as schema from "../../../src/db/schema";
import { saveCompetitionEntryRosterInTx, withdrawCompetitionEntryParticipationInTx } from "../../../src/lib/competition-entries/commands";
import { requestCompetitionEntryRosterChangeInTx } from "../../../src/lib/competition-entries/roster-change";
import { ErrorCode } from "../../../src/lib/errors";
import { capturePostgresError, createLocalPool } from "./harness/database";

describe("approved competition-entry roster changes", () => {
  it("lets an approved participant withdraw into the existing self-roster-change draft, releases the claim, and keeps Team membership independent", async () => {
    const pool = createLocalPool();
    const client = await pool.connect();
    const database = drizzle(client, { schema });
    const tx = database as unknown as TxDb;
    const ids = {
      season: randomUUID(), team: randomUUID(), representative: randomUUID(), member: randomUUID(), secondMember: randomUUID(), thirdMember: randomUUID(),
      entry: randomUUID(), approvedRevision: randomUUID(), representativeParticipant: randomUUID(), memberParticipant: randomUUID(), secondParticipant: randomUUID(), thirdParticipant: randomUUID(), eventRoster: randomUUID(),
    };
    try {
      await client.query("BEGIN");
      await database.insert(schema.users).values([
        { id: ids.representative, email: `${ids.representative}@local.test` },
        { id: ids.member, email: `${ids.member}@local.test` },
        { id: ids.secondMember, email: `${ids.secondMember}@local.test` },
        { id: ids.thirdMember, email: `${ids.thirdMember}@local.test` },
      ]);
      await database.insert(schema.seasons).values({ id: ids.season, slug: ids.season, name: "Participant withdrawal", kind: "custom", registrationMode: "team", status: "registration", registrationOpensAt: new Date(Date.now() - 60_000), registrationOpenedAt: new Date(Date.now() - 60_000), registrationClosesAt: new Date(Date.now() + 86_400_000), rosterChangeClosesAt: new Date(Date.now() + 172_800_000), minTeamSize: 1, maxTeamSize: 9, starterCount: 1 });
      await database.insert(schema.teams).values({ id: ids.team, slug: ids.team, name: "Independent team", creatorUserId: ids.representative, captainUserId: ids.representative });
      await database.insert(schema.teamMemberships).values([
        { teamId: ids.team, userId: ids.representative },
        { teamId: ids.team, userId: ids.member },
        { teamId: ids.team, userId: ids.secondMember },
        { teamId: ids.team, userId: ids.thirdMember },
      ]);
      await database.insert(schema.teamCaptainChanges).values({ teamId: ids.team, fromUserId: null, toUserId: ids.representative, changedByActorId: ids.representative });
      await database.insert(schema.competitionEntries).values({ id: ids.entry, competitionId: ids.season, source: "linked_team", teamId: ids.team, name: "Independent team", representativeUserId: ids.representative, registrationStatus: "approved", currentRosterRevisionId: ids.approvedRevision, approvedRosterRevisionId: ids.approvedRevision });
      await database.insert(schema.competitionEntryRosterRevisions).values({ id: ids.approvedRevision, entryId: ids.entry, revisionNumber: 1, status: "approved", createdBy: ids.representative, approvedAt: new Date() });
      await database.insert(schema.competitionEntryParticipants).values([
        { id: ids.representativeParticipant, entryId: ids.entry, userId: ids.representative, status: "confirmed", invitedByUserId: ids.representative, confirmedAt: new Date() },
        { id: ids.memberParticipant, entryId: ids.entry, userId: ids.member, status: "confirmed", invitedByUserId: ids.representative, confirmedAt: new Date() },
        { id: ids.secondParticipant, entryId: ids.entry, userId: ids.secondMember, status: "confirmed", invitedByUserId: ids.representative, confirmedAt: new Date() },
        { id: ids.thirdParticipant, entryId: ids.entry, userId: ids.thirdMember, status: "confirmed", invitedByUserId: ids.representative, confirmedAt: new Date() },
      ]);
      await database.insert(schema.competitionEntryActiveClaims).values([
        { competitionId: ids.season, userId: ids.representative, entryId: ids.entry, participantId: ids.representativeParticipant },
        { competitionId: ids.season, userId: ids.member, entryId: ids.entry, participantId: ids.memberParticipant },
        { competitionId: ids.season, userId: ids.secondMember, entryId: ids.entry, participantId: ids.secondParticipant },
        { competitionId: ids.season, userId: ids.thirdMember, entryId: ids.entry, participantId: ids.thirdParticipant },
      ]);
      await database.insert(schema.competitionEntryRosterMembers).values([
        { revisionId: ids.approvedRevision, participantId: ids.representativeParticipant, userId: ids.representative, isPrimaryStarter: true },
        { revisionId: ids.approvedRevision, participantId: ids.memberParticipant, userId: ids.member, isPrimaryStarter: false },
        { revisionId: ids.approvedRevision, participantId: ids.secondParticipant, userId: ids.secondMember, isPrimaryStarter: false },
        { revisionId: ids.approvedRevision, participantId: ids.thirdParticipant, userId: ids.thirdMember, isPrimaryStarter: false },
      ]);
      await database.insert(schema.eventRosters).values({ id: ids.eventRoster, entryId: ids.entry, sourceRosterRevisionId: ids.approvedRevision, status: "confirmed", confirmedAt: new Date(), confirmedBy: ids.representative });

      await expect(capturePostgresError(client, () => withdrawCompetitionEntryParticipationInTx(tx, { entryId: ids.entry, userId: ids.representative, actorId: ids.representative }))).resolves.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
      await withdrawCompetitionEntryParticipationInTx(tx, { entryId: ids.entry, userId: ids.member, actorId: ids.member });

      const afterFirst = await database.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, ids.entry) });
      expect(afterFirst).toMatchObject({ registrationStatus: "changes_requested", approvedRosterRevisionId: ids.approvedRevision });
      expect(afterFirst?.currentRosterRevisionId).not.toBe(ids.approvedRevision);
      const currentRevision = await database.query.competitionEntryRosterRevisions.findFirst({ where: eq(schema.competitionEntryRosterRevisions.id, afterFirst!.currentRosterRevisionId) });
      expect(currentRevision).toMatchObject({ status: "draft", origin: "self_roster_change" });
      expect(await database.query.eventRosters.findFirst({ where: eq(schema.eventRosters.id, ids.eventRoster) })).toMatchObject({ status: "preparing", sourceRosterRevisionId: ids.approvedRevision });
      const approvedMembers = await database.select({ userId: schema.competitionEntryRosterMembers.userId }).from(schema.competitionEntryRosterMembers).where(eq(schema.competitionEntryRosterMembers.revisionId, ids.approvedRevision));
      expect(approvedMembers.map((row) => row.userId).sort()).toEqual([ids.member, ids.representative, ids.secondMember, ids.thirdMember].sort());
      const currentMembers = await database.select({ userId: schema.competitionEntryRosterMembers.userId }).from(schema.competitionEntryRosterMembers).where(eq(schema.competitionEntryRosterMembers.revisionId, afterFirst!.currentRosterRevisionId));
      expect(currentMembers.map((row) => row.userId).sort()).toEqual([ids.representative, ids.secondMember, ids.thirdMember].sort());
      expect(await database.query.competitionEntryParticipants.findFirst({ where: eq(schema.competitionEntryParticipants.id, ids.memberParticipant) })).toMatchObject({ status: "withdrawn" });
      expect(await database.select().from(schema.competitionEntryActiveClaims).where(eq(schema.competitionEntryActiveClaims.participantId, ids.memberParticipant))).toEqual([]);
      expect(await database.query.teamMemberships.findFirst({ where: and(eq(schema.teamMemberships.teamId, ids.team), eq(schema.teamMemberships.userId, ids.member)) })).toMatchObject({ status: "active", endedAt: null });

      // A second participant withdraws without cloning a second revision.
      await withdrawCompetitionEntryParticipationInTx(tx, { entryId: ids.entry, userId: ids.secondMember, actorId: ids.secondMember });
      const currentMembersAfterSecond = await database.select({ userId: schema.competitionEntryRosterMembers.userId }).from(schema.competitionEntryRosterMembers).where(eq(schema.competitionEntryRosterMembers.revisionId, afterFirst!.currentRosterRevisionId));
      expect(currentMembersAfterSecond.map((row) => row.userId).sort()).toEqual([ids.representative, ids.thirdMember].sort());
      expect(await database.select().from(schema.competitionEntryActiveClaims).where(eq(schema.competitionEntryActiveClaims.participantId, ids.secondParticipant))).toEqual([]);
      const frozenAt = new Date();
      await database.update(schema.eventRosters).set({ status: "frozen", confirmedAt: frozenAt, confirmedBy: ids.representative, frozenAt, frozenBy: ids.representative }).where(eq(schema.eventRosters.id, ids.eventRoster));
      await expect(capturePostgresError(client, () => withdrawCompetitionEntryParticipationInTx(tx, { entryId: ids.entry, userId: ids.thirdMember, actorId: ids.thirdMember }))).resolves.toMatchObject({ code: ErrorCode.REGISTRATION_INVALID_TRANSITION });
      const withdrawalAudits = await database.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.targetId, ids.entry), eq(schema.auditLogs.action, "competition_entry.participant.withdraw")));
      expect(withdrawalAudits).toHaveLength(2);
      expect(withdrawalAudits.every((audit) => (audit.meta as { source?: string } | null)?.source === "participant_self_withdrawal")).toBe(true);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      await pool.end();
    }
  });

  it("lets the representative remove a confirmed member only from the new draft, releases the claim, and preserves history", async () => {
    const pool = createLocalPool();
    const client = await pool.connect();
    const database = drizzle(client, { schema });
    const tx = database as unknown as TxDb;
    const ids = { season: randomUUID(), team: randomUUID(), representative: randomUUID(), member: randomUUID(), entry: randomUUID(), approvedRevision: randomUUID(), representativeParticipant: randomUUID(), memberParticipant: randomUUID() };
    try {
      await client.query("BEGIN");
      await database.insert(schema.users).values([
          { id: ids.representative, email: `${ids.representative}@local.test` },
          { id: ids.member, email: `${ids.member}@local.test` },
      ]);
      await database.insert(schema.seasons).values({ id: ids.season, slug: ids.season, name: "Roster change", kind: "custom", registrationMode: "team", status: "registration", registrationOpensAt: new Date(Date.now() - 60_000), registrationOpenedAt: new Date(Date.now() - 60_000), registrationClosesAt: new Date(Date.now() + 86_400_000), minTeamSize: 1, maxTeamSize: 9, starterCount: 1 });
      await database.insert(schema.teams).values({ id: ids.team, slug: ids.team, name: "Roster team", creatorUserId: ids.representative, captainUserId: ids.representative });
      await database.insert(schema.teamMemberships).values([
          { teamId: ids.team, userId: ids.representative },
          { teamId: ids.team, userId: ids.member },
      ]);
      await database.insert(schema.teamCaptainChanges).values({ teamId: ids.team, fromUserId: null, toUserId: ids.representative, changedByActorId: ids.representative });
      await database.insert(schema.competitionEntries).values({ id: ids.entry, competitionId: ids.season, source: "linked_team", teamId: ids.team, name: "Roster team", representativeUserId: ids.representative, registrationStatus: "approved", currentRosterRevisionId: ids.approvedRevision, approvedRosterRevisionId: ids.approvedRevision });
      await database.insert(schema.competitionEntryRosterRevisions).values({ id: ids.approvedRevision, entryId: ids.entry, revisionNumber: 1, status: "approved", createdBy: ids.representative, approvedAt: new Date() });
      await database.insert(schema.competitionEntryParticipants).values([
          { id: ids.representativeParticipant, entryId: ids.entry, userId: ids.representative, status: "confirmed", invitedByUserId: ids.representative, confirmedAt: new Date() },
          { id: ids.memberParticipant, entryId: ids.entry, userId: ids.member, status: "confirmed", invitedByUserId: ids.representative, confirmedAt: new Date() },
      ]);
      await database.insert(schema.competitionEntryActiveClaims).values([
          { competitionId: ids.season, userId: ids.representative, entryId: ids.entry, participantId: ids.representativeParticipant },
          { competitionId: ids.season, userId: ids.member, entryId: ids.entry, participantId: ids.memberParticipant },
      ]);
      await database.insert(schema.competitionEntryRosterMembers).values([
          { revisionId: ids.approvedRevision, participantId: ids.representativeParticipant, userId: ids.representative, isPrimaryStarter: true },
          { revisionId: ids.approvedRevision, participantId: ids.memberParticipant, userId: ids.member, isPrimaryStarter: false },
      ]);

      await requestCompetitionEntryRosterChangeInTx(tx, { entryId: ids.entry, representativeUserId: ids.representative, actorId: ids.representative });
      expect(await capturePostgresError(client, () => saveCompetitionEntryRosterInTx(tx, { entryId: ids.entry, userId: ids.representative, actorId: ids.representative, userIds: [ids.member], primaryStarterUserIds: [ids.member] }))).toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
      await saveCompetitionEntryRosterInTx(tx, { entryId: ids.entry, userId: ids.representative, actorId: ids.representative, userIds: [ids.representative], primaryStarterUserIds: [ids.representative] });

      const entry = await database.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, ids.entry) });
      expect(entry?.registrationStatus).toBe("changes_requested");
      expect(entry?.approvedRosterRevisionId).toBe(ids.approvedRevision);
      expect(entry?.currentRosterRevisionId).not.toBe(ids.approvedRevision);
      const approvedMembers = await database.select({ userId: schema.competitionEntryRosterMembers.userId }).from(schema.competitionEntryRosterMembers).where(eq(schema.competitionEntryRosterMembers.revisionId, ids.approvedRevision));
      expect(approvedMembers.map((row) => row.userId).sort()).toEqual([ids.member, ids.representative].sort());
      expect(await database.query.competitionEntryParticipants.findFirst({ where: and(eq(schema.competitionEntryParticipants.entryId, ids.entry), eq(schema.competitionEntryParticipants.userId, ids.member)) })).toMatchObject({ status: "withdrawn" });
      const released = await database.select().from(schema.competitionEntryActiveClaims).where(eq(schema.competitionEntryActiveClaims.participantId, ids.memberParticipant));
      expect(released).toEqual([]);
      const audit = await database.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.targetId, ids.entry), eq(schema.auditLogs.action, "competition_entry.participant.remove")));
      expect(audit).toHaveLength(1);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      await pool.end();
    }
  });
});

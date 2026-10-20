import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import type { TxDb } from "../../../src/db/client";
import * as schema from "../../../src/db/schema";
import { createMajor24Capabilities } from "@/lib/competition/templates";
import { withdrawCompetitionEntryParticipationInTx, transferCompetitionEntryParticipationInTx } from "@/lib/competition-entries/commands";
import { requestCompetitionEntryRosterChangeInTx } from "@/lib/competition-entries/roster-change";
import { disbandTeamInTx } from "@/lib/teams/commands";
import { canReleaseEliminatedParticipationInTx } from "@/lib/major/eliminated-entry";
import { getCompetitionEntryCapabilities } from "@/lib/competition-entries/capabilities";
import { capturePostgresError, createLocalPool } from "./harness/database";

describe("eliminated Major participant transfer", () => {
  it("releases players and the historical representative without rewriting history, then accepts a qualified-team invitation", async () => {
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
      await database.insert(schema.seasons).values({ id: ids.season, slug: ids.season, name: "Participant withdrawal", ...createMajor24Capabilities(), kind: "Major", competitionTemplate: "major", registrationMode: "team", status: "registration", registrationOpensAt: new Date(Date.now() - 60_000), registrationOpenedAt: new Date(Date.now() - 60_000), registrationClosesAt: new Date(Date.now() - 30_000), rosterChangeClosesAt: new Date(Date.now() + 172_800_000), minTeamSize: 1, maxTeamSize: 9, starterCount: 1 });
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

      const [run] = await database.insert(schema.competitionQualificationRuns).values({ seasonId: ids.season, format: "short_swiss_2w2l", targetEntrantCount: 24, candidateCount: 30, directEntryCount: 18, playInEntryCount: 12, qualifierCount: 6, configuredBy: ids.representative, startedAt: new Date(), startedBy: ids.representative }).returning();
      await database.insert(schema.competitionQualificationEntrants).values({ runId: run!.id, seasonId: ids.season, competitionEntryId: ids.entry, preliminarySeed: 30 });
      const targetTeamId = randomUUID();
      await database.insert(schema.teams).values({ id: targetTeamId, slug: targetTeamId, name: "新队", creatorUserId: ids.thirdMember, captainUserId: ids.thirdMember });
      await database.insert(schema.teamCaptainChanges).values({ teamId: targetTeamId, fromUserId: null, toUserId: ids.thirdMember, changedByActorId: ids.thirdMember });
      const qualified: string[] = [];
      for (let i = 0; i < 24; i++) {
        const id = randomUUID(), revision = randomUUID(); qualified.push(id);
        await database.insert(schema.competitionEntries).values({ id, competitionId: ids.season, source: i === 0 ? "linked_team" : "event_native", teamId: i === 0 ? targetTeamId : null, name: `晋级队 ${i}`, representativeUserId: ids.thirdMember, registrationStatus: "approved", currentRosterRevisionId: revision, approvedRosterRevisionId: revision });
        await database.insert(schema.competitionEntryRepresentativeChanges).values({ entryId: id, toUserId: ids.thirdMember, changedByActorId: ids.thirdMember });
        await database.insert(schema.competitionEntryRosterRevisions).values({ id: revision, entryId: id, revisionNumber: 1, status: "approved", createdBy: ids.thirdMember, approvedAt: new Date() });
        await database.insert(schema.majorTournamentEntrants).values({ seasonId: ids.season, competitionEntryId: id });
      }
      const season = (await database.query.seasons.findFirst({ where: eq(schema.seasons.id, ids.season) }))!;
      expect(await canReleaseEliminatedParticipationInTx(tx, season, ids.entry)).toBe(false);
      await database.update(schema.competitionQualificationRuns).set({ completedAt: new Date() }).where(eq(schema.competitionQualificationRuns.id, run!.id));
      expect(await canReleaseEliminatedParticipationInTx(tx, season, ids.entry)).toBe(true);
      expect(await canReleaseEliminatedParticipationInTx(tx, season, qualified[0]!)).toBe(false);
      const caps = getCompetitionEntryCapabilities({ season, entry: { status: "approved", hasApprovedRoster: true }, revision: { status: "approved", origin: "initial" }, rosterFrozen: true, majorAdjustmentPhaseOpen: false, eliminatedParticipationRelease: true });
      expect(caps).toMatchObject({ canWithdrawParticipation: true, canReleaseEliminatedParticipation: true, canEditCurrentRoster: false, canRequestRosterChange: false });
      const history = await database.select().from(schema.competitionEntryRosterMembers).where(eq(schema.competitionEntryRosterMembers.revisionId, ids.approvedRevision));
      const oldRoster = await database.query.eventRosters.findFirst({ where: eq(schema.eventRosters.id, ids.eventRoster) });
      await withdrawCompetitionEntryParticipationInTx(tx, { entryId: ids.entry, userId: ids.member, actorId: ids.member });
      expect(await database.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, ids.entry) })).toMatchObject({ registrationStatus: "approved", currentRosterRevisionId: ids.approvedRevision, approvedRosterRevisionId: ids.approvedRevision, representativeUserId: ids.representative });
      expect(await database.select().from(schema.competitionEntryRosterMembers).where(eq(schema.competitionEntryRosterMembers.revisionId, ids.approvedRevision))).toEqual(history);
      expect(await database.query.eventRosters.findFirst({ where: eq(schema.eventRosters.id, ids.eventRoster) })).toEqual(oldRoster);

      await requestCompetitionEntryRosterChangeInTx(tx, { entryId: qualified[0]!, representativeUserId: ids.thirdMember, actorId: ids.thirdMember });
      const target = (await database.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, qualified[0]!) }))!;
      const participant = randomUUID();
      await database.insert(schema.competitionEntryParticipants).values({ id: participant, entryId: target.id, userId: ids.representative, status: "invited", invitedByUserId: ids.thirdMember });
      await database.insert(schema.competitionEntryRosterMembers).values({ revisionId: target.currentRosterRevisionId, participantId: participant, userId: ids.representative, isPrimaryStarter: true });
      const transfer = () => transferCompetitionEntryParticipationInTx(tx, { entryId: target.id, fromEntryId: ids.entry, userId: ids.representative, actorId: ids.representative });
      const oldClaim = await database.query.competitionEntryActiveClaims.findFirst({ where: eq(schema.competitionEntryActiveClaims.participantId, ids.representativeParticipant) });
      expect(await capturePostgresError(client, transfer)).toMatchObject({ code: "VALIDATION_FAILED" });
      expect(await database.query.competitionEntryActiveClaims.findFirst({ where: eq(schema.competitionEntryActiveClaims.participantId, ids.representativeParticipant) })).toEqual(oldClaim);
      await database.update(schema.teamMemberships).set({ status: "left", endedAt: new Date(), endedReason: "left" }).where(and(eq(schema.teamMemberships.teamId, ids.team), eq(schema.teamMemberships.userId, ids.representative)));
      await database.insert(schema.teamMemberships).values({ teamId: targetTeamId, userId: ids.representative });
      // A stale invitation must roll back the release and its audit together.
      await database.delete(schema.competitionEntryRosterMembers).where(eq(schema.competitionEntryRosterMembers.participantId, participant));
      const auditBefore = await database.select().from(schema.auditLogs).where(eq(schema.auditLogs.seasonId, ids.season));
      expect(await capturePostgresError(client, transfer)).toMatchObject({ code: "REGISTRATION_INVALID_TRANSITION" });
      expect(await database.query.competitionEntryActiveClaims.findFirst({ where: eq(schema.competitionEntryActiveClaims.participantId, ids.representativeParticipant) })).toEqual(oldClaim);
      expect(await database.query.competitionEntryParticipants.findFirst({ where: eq(schema.competitionEntryParticipants.id, ids.representativeParticipant) })).toMatchObject({ status: "confirmed" });
      expect(await database.select().from(schema.auditLogs).where(eq(schema.auditLogs.seasonId, ids.season))).toEqual(auditBefore);
      await database.insert(schema.competitionEntryRosterMembers).values({ revisionId: target.currentRosterRevisionId, participantId: participant, userId: ids.representative, isPrimaryStarter: true });
      expect(await capturePostgresError(client, () => transferCompetitionEntryParticipationInTx(tx, { entryId: target.id, fromEntryId: qualified[1]!, userId: ids.representative, actorId: ids.representative }))).toMatchObject({ code: "REGISTRATION_INVALID_TRANSITION" });
      expect(await capturePostgresError(client, () => transferCompetitionEntryParticipationInTx(tx, { entryId: target.id, fromEntryId: ids.entry, userId: ids.secondMember, actorId: ids.secondMember }))).toBeDefined();
      await database.update(schema.seasons).set({ rosterChangeClosesAt: new Date(Date.now() - 1000) }).where(eq(schema.seasons.id, ids.season));
      expect(await capturePostgresError(client, transfer)).toMatchObject({ code: "REGISTRATION_CLOSED" });
      await database.update(schema.seasons).set({ rosterChangeClosesAt: new Date(Date.now() + 172_800_000) }).where(eq(schema.seasons.id, ids.season));
      await transfer();
      expect(await database.select().from(schema.competitionEntryRosterMembers).where(eq(schema.competitionEntryRosterMembers.revisionId, ids.approvedRevision))).toEqual(history);
      expect(await database.query.eventRosters.findFirst({ where: eq(schema.eventRosters.id, ids.eventRoster) })).toEqual(oldRoster);
      expect(await database.query.competitionEntryParticipants.findFirst({ where: eq(schema.competitionEntryParticipants.id, participant) })).toMatchObject({ status: "confirmed" });
      expect(await database.query.competitionEntryActiveClaims.findFirst({ where: and(eq(schema.competitionEntryActiveClaims.competitionId, ids.season), eq(schema.competitionEntryActiveClaims.userId, ids.representative)) })).toMatchObject({ entryId: target.id });
      await database.update(schema.seasons).set({ rosterChangeClosesAt: new Date(Date.now() - 1000) }).where(eq(schema.seasons.id, ids.season));
      await expect(capturePostgresError(client, () => withdrawCompetitionEntryParticipationInTx(tx, { entryId: ids.entry, userId: ids.secondMember, actorId: ids.secondMember }))).resolves.toMatchObject({ code: "REGISTRATION_CLOSED" });
      await disbandTeamInTx(tx, { teamId: ids.team, actorUserId: ids.representative, actorId: ids.representative, emergencyOverride: false });
      expect(await database.query.teams.findFirst({ where: eq(schema.teams.id, ids.team) })).toMatchObject({ status: "disbanded" });
      expect(await database.select().from(schema.competitionEntryRosterMembers).where(eq(schema.competitionEntryRosterMembers.revisionId, ids.approvedRevision))).toEqual(history);
    } finally {
      await client.query("ROLLBACK").catch(() => {}); client.release(); await pool.end();
    }
  });
});

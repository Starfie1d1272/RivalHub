import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import type { TxDb } from "../../../src/db/client";
import * as schema from "../../../src/db/schema";
import { confirmCompetitionEntryParticipationInTx, withdrawCompetitionEntryParticipationInTx } from "../../../src/lib/competition-entries/commands";
import { loadCompetitionEntryParticipantContext } from "../../../src/lib/competition-entries/participant-context";
import { ErrorCode } from "../../../src/lib/errors";
import { capturePostgresError, createLocalPool } from "./harness/database";

describe("competition-entry participant context", () => {
  it("deduplicates an Entry when the user is both its representative and participant", async () => {
    const pool = createLocalPool();
    const client = await pool.connect();
    const database = drizzle(client, { schema });
    const tx = database as unknown as TxDb;
    const ids = { season: randomUUID(), user: randomUUID(), team: randomUUID(), entry: randomUUID(), revision: randomUUID(), participant: randomUUID() };

    try {
      await client.query("BEGIN");
      await database.insert(schema.users).values({ id: ids.user, email: `${ids.user}@local.test` });
      await database.insert(schema.seasons).values({ id: ids.season, slug: ids.season, name: "Participant context duplicate", kind: "custom", registrationMode: "team", status: "registration", minTeamSize: 1, maxTeamSize: 9, starterCount: 1 });
      await database.insert(schema.teams).values({ id: ids.team, slug: ids.team, name: "同一队伍", creatorUserId: ids.user, captainUserId: ids.user });
      await database.insert(schema.competitionEntries).values({ id: ids.entry, competitionId: ids.season, source: "linked_team", teamId: ids.team, name: "同一队伍", representativeUserId: ids.user, registrationStatus: "draft", currentRosterRevisionId: ids.revision });
      await database.insert(schema.competitionEntryRosterRevisions).values({ id: ids.revision, entryId: ids.entry, revisionNumber: 1, status: "draft", createdBy: ids.user });
      await database.insert(schema.competitionEntryParticipants).values({ id: ids.participant, entryId: ids.entry, userId: ids.user, status: "invited", invitedByUserId: ids.user });

      const context = await loadCompetitionEntryParticipantContext({ competitionId: ids.season, userId: ids.user }, tx);
      expect(context.primaryEntry?.id).toBe(ids.entry);
      expect(context.activeClaimEntryId).toBeNull();
      expect(context.invitationConflict).toBeNull();
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      await pool.end();
    }
  });

  it("keeps the active participation visible until the player withdraws, then exposes the newer invitation", async () => {
    const pool = createLocalPool();
    const client = await pool.connect();
    const database = drizzle(client, { schema });
    const tx = database as unknown as TxDb;
    const ids = {
      season: randomUUID(), player: randomUUID(), oldCaptain: randomUUID(), newCaptain: randomUUID(), oldTeam: randomUUID(), newTeam: randomUUID(),
      oldEntry: randomUUID(), newEntry: randomUUID(), oldRevision: randomUUID(), newRevision: randomUUID(),
      oldParticipant: randomUUID(), newParticipant: randomUUID(), oldMembership: randomUUID(), newMembership: randomUUID(),
    };
    const earlier = new Date("2026-01-01T00:00:00.000Z");
    const later = new Date("2026-01-02T00:00:00.000Z");

    try {
      await client.query("BEGIN");
      await database.insert(schema.users).values([
        { id: ids.player, email: `${ids.player}@local.test` },
        { id: ids.oldCaptain, email: `${ids.oldCaptain}@local.test` },
        { id: ids.newCaptain, email: `${ids.newCaptain}@local.test` },
      ]);
      await database.insert(schema.seasons).values({
        id: ids.season,
        slug: ids.season,
        name: "Participant context",
        kind: "custom",
        registrationMode: "team",
        status: "registration",
        registrationOpensAt: new Date(Date.now() - 60_000),
        registrationOpenedAt: new Date(Date.now() - 60_000),
        registrationClosesAt: new Date(Date.now() + 86_400_000),
        minTeamSize: 1,
        maxTeamSize: 9,
        starterCount: 1,
      });
      await database.insert(schema.teams).values([
        { id: ids.oldTeam, slug: ids.oldTeam, name: "旧队", creatorUserId: ids.oldCaptain, captainUserId: ids.oldCaptain },
        { id: ids.newTeam, slug: ids.newTeam, name: "新队", creatorUserId: ids.newCaptain, captainUserId: ids.newCaptain },
      ]);
      await database.insert(schema.teamMemberships).values([
        { id: ids.oldMembership, teamId: ids.oldTeam, userId: ids.player, status: "left", endedAt: earlier, endedReason: "left" },
        { id: ids.newMembership, teamId: ids.newTeam, userId: ids.player, status: "active" },
      ]);
      await database.insert(schema.competitionEntries).values([
        { id: ids.oldEntry, competitionId: ids.season, source: "linked_team", teamId: ids.oldTeam, name: "旧队", representativeUserId: ids.oldCaptain, registrationStatus: "draft", currentRosterRevisionId: ids.oldRevision, updatedAt: earlier },
        { id: ids.newEntry, competitionId: ids.season, source: "linked_team", teamId: ids.newTeam, name: "新队", representativeUserId: ids.newCaptain, registrationStatus: "draft", currentRosterRevisionId: ids.newRevision, updatedAt: later },
      ]);
      await database.insert(schema.competitionEntryRosterRevisions).values([
        { id: ids.oldRevision, entryId: ids.oldEntry, revisionNumber: 1, status: "draft", createdBy: ids.player },
        { id: ids.newRevision, entryId: ids.newEntry, revisionNumber: 1, status: "draft", createdBy: ids.player },
      ]);
      await database.insert(schema.competitionEntryParticipants).values([
        { id: ids.oldParticipant, entryId: ids.oldEntry, userId: ids.player, status: "confirmed", invitedByUserId: ids.player, confirmedAt: earlier },
        { id: ids.newParticipant, entryId: ids.newEntry, userId: ids.player, status: "invited", invitedByUserId: ids.player },
      ]);
      await database.insert(schema.competitionEntryRosterMembers).values([
        { revisionId: ids.oldRevision, participantId: ids.oldParticipant, userId: ids.player, teamMembershipId: ids.oldMembership, isPrimaryStarter: true },
        { revisionId: ids.newRevision, participantId: ids.newParticipant, userId: ids.player, teamMembershipId: ids.newMembership, isPrimaryStarter: true },
      ]);
      await database.insert(schema.competitionEntryActiveClaims).values({
        competitionId: ids.season,
        userId: ids.player,
        entryId: ids.oldEntry,
        participantId: ids.oldParticipant,
      });

      const beforeWithdrawal = await loadCompetitionEntryParticipantContext({ competitionId: ids.season, userId: ids.player }, tx);
      expect(beforeWithdrawal.primaryEntry?.id).toBe(ids.oldEntry);
      expect(beforeWithdrawal.activeClaimEntryId).toBe(ids.oldEntry);
      expect(beforeWithdrawal.invitationConflict).toEqual({ pendingInvitationCount: 1, latestPendingInvitationName: "新队" });

      await expect(capturePostgresError(client, () => confirmCompetitionEntryParticipationInTx(tx, { entryId: ids.newEntry, userId: ids.player, actorId: ids.player })))
        .resolves.toMatchObject({ code: ErrorCode.REGISTRATION_DUPLICATE });
      expect(await database.query.competitionEntryActiveClaims.findFirst({ where: and(eq(schema.competitionEntryActiveClaims.competitionId, ids.season), eq(schema.competitionEntryActiveClaims.userId, ids.player)) })).toMatchObject({ entryId: ids.oldEntry });

      await withdrawCompetitionEntryParticipationInTx(tx, { entryId: ids.oldEntry, userId: ids.player, actorId: ids.player });
      expect(await database.query.competitionEntryParticipants.findFirst({ where: eq(schema.competitionEntryParticipants.id, ids.oldParticipant) })).toMatchObject({ status: "withdrawn" });
      expect(await database.query.teamMemberships.findFirst({ where: eq(schema.teamMemberships.id, ids.oldMembership) })).toMatchObject({ status: "left", endedAt: earlier });

      const afterWithdrawal = await loadCompetitionEntryParticipantContext({ competitionId: ids.season, userId: ids.player }, tx);
      expect(afterWithdrawal.primaryEntry?.id).toBe(ids.newEntry);
      expect(afterWithdrawal.activeClaimEntryId).toBeNull();
      expect(afterWithdrawal.invitationConflict).toBeNull();

      await confirmCompetitionEntryParticipationInTx(tx, { entryId: ids.newEntry, userId: ids.player, actorId: ids.player });
      expect(await database.query.competitionEntryParticipants.findFirst({ where: eq(schema.competitionEntryParticipants.id, ids.newParticipant) })).toMatchObject({ status: "confirmed" });
      expect(await database.query.competitionEntryActiveClaims.findFirst({ where: and(eq(schema.competitionEntryActiveClaims.competitionId, ids.season), eq(schema.competitionEntryActiveClaims.userId, ids.player)) })).toMatchObject({ entryId: ids.newEntry });
      const audits = await database.select({ action: schema.auditLogs.action }).from(schema.auditLogs)
        .where(and(eq(schema.auditLogs.seasonId, ids.season), eq(schema.auditLogs.actorId, ids.player)));
      expect(audits.map((audit) => audit.action)).toEqual(expect.arrayContaining([
        "competition_entry.participant.withdraw",
        "competition_entry.participant.confirm",
      ]));
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      await pool.end();
    }
  });
});

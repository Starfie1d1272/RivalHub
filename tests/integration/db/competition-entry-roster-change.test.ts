import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { saveCompetitionEntryRosterInTx } from "../../../src/lib/competition-entries/commands";
import { requestCompetitionEntryRosterChangeInTx } from "../../../src/lib/competition-entries/roster-change";
import { ErrorCode } from "../../../src/lib/errors";
import { createLocalPool } from "./harness/database";

describe("approved competition-entry roster changes", () => {
  it("lets the representative remove a confirmed member only from the new draft, releases the claim, and preserves history", async () => {
    const pool = createLocalPool();
    const client = await pool.connect();
    const database = drizzle(client, { schema });
    const ids = { season: randomUUID(), team: randomUUID(), representative: randomUUID(), member: randomUUID(), entry: randomUUID(), approvedRevision: randomUUID(), representativeParticipant: randomUUID(), memberParticipant: randomUUID() };
    try {
      await client.query("BEGIN");
      await database.transaction(async (tx) => {
        await tx.insert(schema.users).values([
          { id: ids.representative, email: `${ids.representative}@local.test` },
          { id: ids.member, email: `${ids.member}@local.test` },
        ]);
        await tx.insert(schema.seasons).values({ id: ids.season, slug: ids.season, name: "Roster change", kind: "custom", registrationMode: "team", status: "registration", registrationOpensAt: new Date(Date.now() - 60_000), registrationOpenedAt: new Date(Date.now() - 60_000), registrationClosesAt: new Date(Date.now() + 86_400_000), minTeamSize: 1, maxTeamSize: 9, starterCount: 1 });
        await tx.insert(schema.teams).values({ id: ids.team, slug: ids.team, name: "Roster team", creatorUserId: ids.representative, captainUserId: ids.representative });
        await tx.insert(schema.teamMemberships).values([
          { teamId: ids.team, userId: ids.representative },
          { teamId: ids.team, userId: ids.member },
        ]);
        await tx.insert(schema.competitionEntries).values({ id: ids.entry, competitionId: ids.season, source: "linked_team", teamId: ids.team, name: "Roster team", representativeUserId: ids.representative, registrationStatus: "approved", currentRosterRevisionId: ids.approvedRevision, approvedRosterRevisionId: ids.approvedRevision });
        await tx.insert(schema.competitionEntryRosterRevisions).values({ id: ids.approvedRevision, entryId: ids.entry, revisionNumber: 1, status: "approved", createdBy: ids.representative, approvedAt: new Date() });
        await tx.insert(schema.competitionEntryParticipants).values([
          { id: ids.representativeParticipant, entryId: ids.entry, userId: ids.representative, status: "confirmed", invitedByUserId: ids.representative, confirmedAt: new Date() },
          { id: ids.memberParticipant, entryId: ids.entry, userId: ids.member, status: "confirmed", invitedByUserId: ids.representative, confirmedAt: new Date() },
        ]);
        await tx.insert(schema.competitionEntryActiveClaims).values([
          { competitionId: ids.season, userId: ids.representative, entryId: ids.entry, participantId: ids.representativeParticipant },
          { competitionId: ids.season, userId: ids.member, entryId: ids.entry, participantId: ids.memberParticipant },
        ]);
        await tx.insert(schema.competitionEntryRosterMembers).values([
          { revisionId: ids.approvedRevision, participantId: ids.representativeParticipant, userId: ids.representative, isPrimaryStarter: true },
          { revisionId: ids.approvedRevision, participantId: ids.memberParticipant, userId: ids.member, isPrimaryStarter: false },
        ]);
      });

      await database.transaction((tx) => requestCompetitionEntryRosterChangeInTx(tx, { entryId: ids.entry, representativeUserId: ids.representative, actorId: ids.representative }));
      await expect(database.transaction((tx) => saveCompetitionEntryRosterInTx(tx, { entryId: ids.entry, userId: ids.representative, actorId: ids.representative, userIds: [ids.member], primaryStarterUserIds: [ids.member] }))).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
      await database.transaction((tx) => saveCompetitionEntryRosterInTx(tx, { entryId: ids.entry, userId: ids.representative, actorId: ids.representative, userIds: [ids.representative], primaryStarterUserIds: [ids.representative] }));

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

import { and, eq, inArray, sql, type SQLWrapper } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { competitionEntries, competitionEntryActiveClaims, competitionEntryParticipants, competitionEntryRosterMembers, competitionEntryRosterRevisions, seasonRegistrations, userCompetitiveRoles } from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";

/** Only pre-migration revisions retain the historical registration/profile interpretation. */
export function rosterPositionSql(version: SQLWrapper, position: SQLWrapper, seasonId: SQLWrapper | string, userId: SQLWrapper) {
  return sql<string | null>`case when ${version} is null then coalesce(
    (select ${seasonRegistrations.primaryPosition} from ${seasonRegistrations} where ${seasonRegistrations.seasonId} = ${seasonId} and ${seasonRegistrations.userId} = ${userId} limit 1),
    (select ${userCompetitiveRoles.role}::text from ${userCompetitiveRoles} where ${userCompetitiveRoles.userId} = ${userId} and ${userCompetitiveRoles.isPrimary} = true limit 1)
  ) else ${position} end`;
}

/** Copy the legacy interpretation into the new revision and renew consent for declared positions. */
export async function copyRosterPositionsToRevisionInTx(tx: TxDb, input: {
  revision: typeof competitionEntryRosterRevisions.$inferSelect; nextId: string; actorId: string; excludeUserId?: string;
}): Promise<void> {
  const members = await tx.select().from(competitionEntryRosterMembers).where(eq(competitionEntryRosterMembers.revisionId, input.revision.id));
  if (!members.length) return;
  const legacy = input.revision.positionFactsVersion === null;
  const [entry] = await tx.select().from(competitionEntries).where(eq(competitionEntries.id, input.revision.entryId));
  if (!entry) throw new Error("Roster entry missing");
  const prior = legacy ? await tx.select({ userId: competitionEntryRosterMembers.userId, position: rosterPositionSql(competitionEntryRosterRevisions.positionFactsVersion, competitionEntryRosterMembers.primaryPosition, entry.competitionId, competitionEntryRosterMembers.userId) }).from(competitionEntryRosterMembers).innerJoin(competitionEntryRosterRevisions, eq(competitionEntryRosterRevisions.id, competitionEntryRosterMembers.revisionId)).where(eq(competitionEntryRosterMembers.revisionId, input.revision.id)) : [];
  const priorPositions = new Map(prior.map((member) => [member.userId, member.position]));
  if (legacy) {
    const participants = await tx.select().from(competitionEntryParticipants).where(and(eq(competitionEntryParticipants.entryId, entry.id), inArray(competitionEntryParticipants.id, members.map((member) => member.participantId)), eq(competitionEntryParticipants.status, "confirmed")));
    const reset = participants.filter((participant) => participant.userId !== input.excludeUserId && (priorPositions.get(participant.userId) ?? null) !== null);
    if (reset.length) {
      const ids = reset.map((participant) => participant.id);
      await tx.delete(competitionEntryActiveClaims).where(inArray(competitionEntryActiveClaims.participantId, ids));
      await tx.update(competitionEntryParticipants).set({ status: "invited", confirmedAt: null, updatedAt: new Date() }).where(inArray(competitionEntryParticipants.id, ids));
      await writeAuditInTx(tx, { seasonId: entry.competitionId, action: "competition_entry.roster.save", actorId: input.actorId, targetId: entry.id, meta: { source: "legacy_position_conversion", previousRevisionId: input.revision.id, revisionId: input.nextId, confirmationResetParticipantIds: ids } });
    }
  }
  await tx.insert(competitionEntryRosterMembers).values(members.map((member) => ({ revisionId: input.nextId, participantId: member.participantId, userId: member.userId, teamMembershipId: member.teamMembershipId, isPrimaryStarter: member.isPrimaryStarter, primaryPosition: legacy ? priorPositions.get(member.userId) ?? null : member.primaryPosition })));
}

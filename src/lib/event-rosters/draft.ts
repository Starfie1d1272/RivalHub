import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { competitionEntries, competitionEntryParticipants, competitionEntryRosterMembers, eventRosterMembers, eventRosters, seasons } from "@/db/schema";

/** Retire a member of an unapproved, temporary draft roster without deleting history.
 * The caller holds the season lock and changes the participant in the same transaction.
 */
export async function retireDraftRosterMemberInTx(tx: TxDb, entryId: string, participantId: string): Promise<void> {
  const draftRoster = tx.select({ id: eventRosters.id }).from(eventRosters)
    .innerJoin(competitionEntries, eq(competitionEntries.id, eventRosters.entryId))
    .innerJoin(seasons, eq(seasons.id, competitionEntries.competitionId))
    .where(and(
      eq(competitionEntries.id, entryId),
      eq(competitionEntries.source, "event_native"),
      eq(competitionEntries.registrationStatus, "draft"),
      isNull(competitionEntries.approvedRosterRevisionId),
      eq(eventRosters.status, "preparing"),
      eq(seasons.hasDraft, true),
      eq(seasons.status, "drafting"),
    ));
  await tx.update(eventRosterMembers).set({ isCurrent: false }).where(and(
    inArray(eventRosterMembers.eventRosterId, draftRoster),
    eq(eventRosterMembers.participantId, participantId),
    eq(eventRosterMembers.isCurrent, true),
  ));
}

/** Reconcile only the current unapproved draft projection after an admin edit. */
export async function syncDraftRosterInTx(tx: TxDb, entryId: string): Promise<void> {
  const [scope] = await tx.select({ rosterId: eventRosters.id, revisionId: competitionEntries.currentRosterRevisionId })
    .from(eventRosters)
    .innerJoin(competitionEntries, eq(competitionEntries.id, eventRosters.entryId))
    .innerJoin(seasons, eq(seasons.id, competitionEntries.competitionId))
    .where(and(eq(competitionEntries.id, entryId), eq(competitionEntries.source, "event_native"),
      eq(competitionEntries.registrationStatus, "draft"), isNull(competitionEntries.approvedRosterRevisionId),
      eq(eventRosters.status, "preparing"), eq(seasons.hasDraft, true), eq(seasons.status, "drafting")))
    .for("update");
  if (!scope) return;
  const expected = await tx.select({ participantId: competitionEntryRosterMembers.participantId,
    userId: competitionEntryRosterMembers.userId, isPrimaryStarter: competitionEntryRosterMembers.isPrimaryStarter })
    .from(competitionEntryRosterMembers)
    .innerJoin(competitionEntryParticipants, eq(competitionEntryParticipants.id, competitionEntryRosterMembers.participantId))
    .where(and(eq(competitionEntryRosterMembers.revisionId, scope.revisionId), inArray(competitionEntryParticipants.status, ["invited", "confirmed"])));
  const current = await tx.select().from(eventRosterMembers)
    .where(and(eq(eventRosterMembers.eventRosterId, scope.rosterId), eq(eventRosterMembers.isCurrent, true))).for("update");
  const unchanged = (member: typeof current[number]) => expected.some(item => item.participantId === member.participantId && item.userId === member.userId && item.isPrimaryStarter === member.isPrimaryStarter);
  const retired = current.filter(member => !unchanged(member)).map(member => member.id);
  if (retired.length) await tx.update(eventRosterMembers).set({ isCurrent: false }).where(inArray(eventRosterMembers.id, retired));
  const additions = expected.filter(item => !current.some(member => unchanged(member) && member.participantId === item.participantId));
  if (additions.length) await tx.insert(eventRosterMembers).values(additions.map(item => ({ ...item, eventRosterId: scope.rosterId })));
}

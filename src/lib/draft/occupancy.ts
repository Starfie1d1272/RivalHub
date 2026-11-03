import { and, eq, inArray, not, or } from "drizzle-orm";
import type { DB } from "@/db/client";
import { competitionEntries, competitionEntryActiveClaims, competitionEntryParticipants, competitionEntryRosterMembers, eventRosterMembers, eventRosters, seasonRegistrations } from "@/db/schema";

/** Match the occupancy check used when committing a pick. */
export async function loadOccupiedDraftRegistrationIds(executor: Pick<DB, "select">, seasonId: string): Promise<string[]> {
  const rows = await executor.select({ id: seasonRegistrations.id })
    .from(competitionEntryRosterMembers)
    .innerJoin(competitionEntries, eq(competitionEntries.currentRosterRevisionId, competitionEntryRosterMembers.revisionId))
    .innerJoin(competitionEntryParticipants, eq(competitionEntryParticipants.id, competitionEntryRosterMembers.participantId))
    .innerJoin(eventRosters, eq(eventRosters.entryId, competitionEntries.id))
    .innerJoin(seasonRegistrations, and(
      eq(seasonRegistrations.userId, competitionEntryRosterMembers.userId),
      eq(seasonRegistrations.seasonId, competitionEntries.competitionId),
    ))
    .where(and(
      eq(competitionEntries.competitionId, seasonId),
      eq(competitionEntries.source, "event_native"),
      inArray(competitionEntries.registrationStatus, ["draft", "submitted", "changes_requested", "waitlisted", "approved"]),
      eq(eventRosters.status, "preparing"),
      inArray(competitionEntryParticipants.status, ["invited", "confirmed"]),
    ));
  // Outside an event-native preparing formation, the event roster remains the
  // authoritative adopted/frozen snapshot; do not reinterpret it as a draft.
  const adopted = await executor.select({ id: seasonRegistrations.id })
    .from(eventRosterMembers)
    .innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId))
    .innerJoin(competitionEntries, eq(competitionEntries.id, eventRosters.entryId))
    .innerJoin(seasonRegistrations, and(eq(seasonRegistrations.userId, eventRosterMembers.userId), eq(seasonRegistrations.seasonId, competitionEntries.competitionId)))
    .where(and(eq(competitionEntries.competitionId, seasonId), eq(eventRosterMembers.isCurrent, true), or(
      not(eq(competitionEntries.source, "event_native")),
      not(eq(eventRosters.status, "preparing")),
    )));
  const claims = await executor.select({ id: seasonRegistrations.id })
    .from(competitionEntryActiveClaims)
    .innerJoin(seasonRegistrations, and(eq(seasonRegistrations.userId, competitionEntryActiveClaims.userId), eq(seasonRegistrations.seasonId, competitionEntryActiveClaims.competitionId)))
    .where(eq(competitionEntryActiveClaims.competitionId, seasonId));
  return [...new Set([...rows, ...adopted, ...claims].map((row) => row.id))];
}

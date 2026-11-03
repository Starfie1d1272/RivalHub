import { and, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { competitionEntries, eventRosterMembers, eventRosters, seasonRegistrations } from "@/db/schema";

/** Match the occupancy check used when committing a pick. */
export async function loadOccupiedDraftRegistrationIds(executor: Pick<DB, "select">, seasonId: string): Promise<string[]> {
  const rows = await executor.select({ id: seasonRegistrations.id })
    .from(eventRosterMembers)
    .innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
    .innerJoin(competitionEntries, eq(eventRosters.entryId, competitionEntries.id))
    .innerJoin(seasonRegistrations, and(
      eq(seasonRegistrations.userId, eventRosterMembers.userId),
      eq(seasonRegistrations.seasonId, competitionEntries.competitionId),
    ))
    .where(and(eq(competitionEntries.competitionId, seasonId), eq(eventRosterMembers.isCurrent, true)));
  return rows.map((row) => row.id);
}

import { and, count, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, eventRosterMembers, eventRosters, seasonRegistrations, users } from "@/db/schema";
import type { Season } from "@/db/schema/seasons";

/** Public participant truth follows the season's registration capability. */
export async function getParticipantSummary(season: Pick<Season, "id" | "registrationMode">): Promise<{ count: number; hasPlayers: boolean }> {
  const [row] = season.registrationMode === "team"
    ? await db.select({ value: count() }).from(eventRosterMembers).innerJoin(users, and(eq(eventRosterMembers.userId, users.id), eq(users.status, "active"))).innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id)).innerJoin(competitionEntries, eq(eventRosters.entryId, competitionEntries.id)).where(eq(competitionEntries.competitionId, season.id))
    : await db.select({ value: count() }).from(seasonRegistrations).innerJoin(users, and(eq(seasonRegistrations.userId, users.id), eq(users.status, "active"))).where(and(eq(seasonRegistrations.seasonId, season.id), eq(seasonRegistrations.status, "approved")));
  const total = Number(row?.value ?? 0);
  return { count: total, hasPlayers: total > 0 };
}

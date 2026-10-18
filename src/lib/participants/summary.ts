import { publicCompetitionEntryCondition } from "@/lib/competition-entries/public-visibility";
import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, eventRosterMembers, eventRosters, seasonRegistrations, users } from "@/db/schema";
import type { Season } from "@/db/schema/seasons";

/** Public participant truth follows the season's registration capability. */
export async function getParticipantSummary(season: Pick<Season, "id" | "registrationMode">): Promise<{ count: number; hasPlayers: boolean }> {
  const [row] = season.registrationMode === "team"
    ? await db.select({ value: count() }).from(eventRosterMembers).innerJoin(users, and(eq(eventRosterMembers.userId, users.id), eq(users.status, "active"))).innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id)).innerJoin(competitionEntries, eq(eventRosters.entryId, competitionEntries.id)).where(and(eq(competitionEntries.competitionId, season.id), publicCompetitionEntryCondition(), eq(eventRosterMembers.isCurrent, true)))
    : await db.select({ value: count() }).from(seasonRegistrations).innerJoin(users, and(eq(seasonRegistrations.userId, users.id), eq(users.status, "active"))).where(and(eq(seasonRegistrations.seasonId, season.id), eq(seasonRegistrations.status, "approved")));
  const total = Number(row?.value ?? 0);
  return { count: total, hasPlayers: total > 0 };
}

/** Directory read: preserve the single-season predicates while grouping counts by season. */
export async function getParticipantSummaries(
  seasons: readonly Pick<Season, "id" | "registrationMode">[],
): Promise<Map<string, { count: number; hasPlayers: boolean }>> {
  const teamIds = seasons.filter((season) => season.registrationMode === "team").map((season) => season.id);
  const individualIds = seasons.filter((season) => season.registrationMode !== "team").map((season) => season.id);
  const [teamRows, individualRows] = await Promise.all([
    teamIds.length
      ? db.select({ seasonId: competitionEntries.competitionId, value: count() })
        .from(eventRosterMembers)
        .innerJoin(users, and(eq(eventRosterMembers.userId, users.id), eq(users.status, "active")))
        .innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
        .innerJoin(competitionEntries, eq(eventRosters.entryId, competitionEntries.id))
        .where(and(inArray(competitionEntries.competitionId, teamIds), publicCompetitionEntryCondition(), eq(eventRosterMembers.isCurrent, true)))
        .groupBy(competitionEntries.competitionId)
      : Promise.resolve([] as { seasonId: string; value: number }[]),
    individualIds.length
      ? db.select({ seasonId: seasonRegistrations.seasonId, value: count() })
        .from(seasonRegistrations)
        .innerJoin(users, and(eq(seasonRegistrations.userId, users.id), eq(users.status, "active")))
        .where(and(inArray(seasonRegistrations.seasonId, individualIds), eq(seasonRegistrations.status, "approved")))
        .groupBy(seasonRegistrations.seasonId)
      : Promise.resolve([] as { seasonId: string; value: number }[]),
  ]);
  const counts = new Map([...teamRows, ...individualRows].map((row) => [row.seasonId, Number(row.value)]));
  return new Map(seasons.map((season) => {
    const total = counts.get(season.id) ?? 0;
    return [season.id, { count: total, hasPlayers: total > 0 }];
  }));
}

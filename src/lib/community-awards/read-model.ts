import { and, eq, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { TxDb } from "@/db/client";
import { competitionEntries, competitionEntryParticipants, eventRosterMembers, eventRosters, seasonAdminGrants, seasonRegistrations, steamProfiles, users } from "@/db/schema";
import { getPublicDisplayName } from "@/lib/identity/display-name";

export type SeasonAwardCandidate = { id: string; name: string };
type CommunityAwardQueryable = Pick<TxDb, "select" | "selectDistinct">;
export const PUBLIC_COMMUNITY_AWARD_STATUSES = ["approved", "awarded", "not_awarded", "cancelled"] as const;

/** A withdrawn award remains public only when it was reviewed and published first. */
export function isPublicCommunityAward(status: string, reviewedAt: Date | null): boolean {
  return (PUBLIC_COMMUNITY_AWARD_STATUSES as readonly string[]).includes(status)
    || (status === "withdrawn" && reviewedAt !== null);
}

export async function getSeasonAwardCandidates(executor: CommunityAwardQueryable, seasonId: string): Promise<SeasonAwardCandidate[]> {
  const rosterEntries = alias(competitionEntries, "award_roster_entries");
  const rows = await executor.selectDistinct({ id: users.id, displayName: users.displayName, perfectName: users.perfectName, personaName: steamProfiles.personaName }).from(users)
    .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
    .leftJoin(seasonAdminGrants, eq(seasonAdminGrants.userId, users.id))
    .leftJoin(seasonRegistrations, eq(seasonRegistrations.userId, users.id))
    .leftJoin(competitionEntryParticipants, eq(competitionEntryParticipants.userId, users.id))
    .leftJoin(competitionEntries, eq(competitionEntryParticipants.entryId, competitionEntries.id))
    .leftJoin(eventRosterMembers, and(eq(eventRosterMembers.userId, users.id), eq(eventRosterMembers.isCurrent, true)))
    .leftJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
    .leftJoin(rosterEntries, eq(eventRosters.entryId, rosterEntries.id))
    .where(or(eq(seasonAdminGrants.seasonId, seasonId), eq(seasonRegistrations.seasonId, seasonId), eq(competitionEntries.competitionId, seasonId), eq(rosterEntries.competitionId, seasonId)));
  return rows.map((row) => ({ id: row.id, name: getPublicDisplayName(row) }));
}

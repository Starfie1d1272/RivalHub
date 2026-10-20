import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, eventRosterMembers, eventRosters, steamProfiles, users } from "@/db/schema";
import { hasActivePublicSanction } from "@/lib/discipline/public-query";
import { publicCompetitionEntryCondition } from "./public-visibility";
import { getOfficialSeasonMatchSummary } from "@/lib/matches/read-official";

export async function getPublicCompetitionEntryDirectory(season: { id: string }) {
  const entries = await db.query.competitionEntries.findMany({ where: and(eq(competitionEntries.competitionId, season.id), publicCompetitionEntryCondition()), orderBy: [asc(competitionEntries.formationOrder), asc(competitionEntries.id)] });
  const members = await db.select({ entryId: eventRosters.entryId, userId: users.id, personaName: steamProfiles.personaName, avatarUrl: steamProfiles.avatarUrl,
        hasActivePublicSanction: hasActivePublicSanction(users.id), perfectName: users.perfectName, displayName: users.displayName, isStarter: eventRosterMembers.isPrimaryStarter })
    .from(eventRosterMembers).innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId)).innerJoin(users, eq(users.id, eventRosterMembers.userId)).leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64)).where(and(inArray(eventRosters.entryId, entries.map((entry) => entry.id)), inArray(eventRosters.status, ["confirmed", "frozen"]), eq(eventRosterMembers.isCurrent, true)));
  const matchSummary = await getOfficialSeasonMatchSummary(season.id);
  return { entries, members, matchSummary, teamCount: entries.length, playerCount: members.length };
}

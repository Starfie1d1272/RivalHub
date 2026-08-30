import "server-only";
import { and, eq, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { matches, competitionEntries } from "@/db/schema";
import { calculateStandings, type TeamStanding } from "@/lib/standings";

export async function getStandings(seasonId: string): Promise<TeamStanding[]> {
  const [allTeams, finished] = await Promise.all([
    db.query.competitionEntries.findMany({
      where: eq(competitionEntries.competitionId, seasonId),
      orderBy: [asc(competitionEntries.formationOrder)],
    }),
    db.query.matches.findMany({
      where: and(eq(matches.seasonId, seasonId), eq(matches.status, "finished")),
      orderBy: [asc(matches.createdAt)],
    }),
  ]);

  return calculateStandings(allTeams, finished);
}

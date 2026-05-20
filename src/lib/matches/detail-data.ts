import { and, eq, or } from "drizzle-orm";
import { db } from "@/db/client";
import { matches } from "@/db/schema";

export function getSeasonFinishedMatches(seasonId: string, teamId: string) {
  return db.query.matches.findMany({
    where: and(
      eq(matches.seasonId, seasonId),
      eq(matches.status, "finished"),
      or(eq(matches.teamAId, teamId), eq(matches.teamBId, teamId)),
    ),
  });
}

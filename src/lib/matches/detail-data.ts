import { officialMatchCondition } from "./scope";
import { requireCompetitionMatch } from "./competition-context";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db/client";
import { matches } from "@/db/schema";

export function getSeasonFinishedMatches(seasonId: string, teamId: string | readonly string[]) {
  const entryIds = typeof teamId === "string" ? [teamId] : [...teamId];
  return db.query.matches.findMany({
    where: and(officialMatchCondition(),
      eq(matches.seasonId, seasonId),
      eq(matches.status, "finished"),
      or(inArray(matches.entryAId, entryIds), inArray(matches.entryBId, entryIds)),
    ),
  }).then(rows => rows.map(requireCompetitionMatch));
}

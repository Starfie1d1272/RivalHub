import "server-only";
import { and, eq, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { competitionEntries, matches } from "@/db/schema";
import { officialMatchCondition } from "@/lib/matches/scope";

export function getOfficialUpcomingMatches(seasonId: string, limit = 4) {
  const teamA = alias(competitionEntries, "team_a");
  const teamB = alias(competitionEntries, "team_b");
  return db.select({ id: matches.id, entryAId: matches.entryAId, entryBId: matches.entryBId,
    status: matches.status, scheduledAt: matches.scheduledAt, format: matches.format, stage: matches.stage,
    teamAName: teamA.name, teamBName: teamB.name,
  }).from(matches).leftJoin(teamA, eq(matches.entryAId, teamA.id)).leftJoin(teamB, eq(matches.entryBId, teamB.id))
    .where(and(officialMatchCondition(), eq(matches.seasonId, seasonId), or(eq(matches.status, "scheduled"), eq(matches.status, "in_progress"))))
    .orderBy(sql`case when ${matches.status} = 'in_progress' then 0 when ${matches.scheduledAt} is not null then 1 else 2 end`, matches.scheduledAt, matches.id)
    .limit(limit);
}

export async function getQualificationMatchProgress(runId: string) {
  const rows = await db.select({ status: matches.status, round: matches.round }).from(matches)
    .where(and(officialMatchCondition(), eq(matches.qualificationRunId, runId)));
  const incompleteRounds = rows.filter(row => row.status !== "finished" && row.round !== null).map(row => row.round!);
  return { currentRound: incompleteRounds.length ? Math.min(...incompleteRounds) : Math.max(0, ...rows.map(row => row.round ?? 0)) + 1 };
}

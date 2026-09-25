import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  competitionEntries,
  competitionQualificationEntrants,
  competitionQualificationRuns,
  matches,
} from "@/db/schema";
import { buildQualificationSwissReadModel } from "@/lib/competition-qualification/presentation";

export async function loadQualificationSwissStageReadModel(seasonId: string) {
  const [run] = await db.select().from(competitionQualificationRuns)
    .where(eq(competitionQualificationRuns.seasonId, seasonId)).limit(1);
  if (!run || run.format !== "short_swiss_2w2l") return null;

  const [entrants, linkedMatches] = await Promise.all([
    db.select({
      entryId: competitionQualificationEntrants.competitionEntryId,
      teamName: competitionEntries.name,
      preliminarySeed: competitionQualificationEntrants.preliminarySeed,
    }).from(competitionQualificationEntrants)
      .innerJoin(competitionEntries, eq(competitionEntries.id, competitionQualificationEntrants.competitionEntryId))
      .where(and(
        eq(competitionQualificationEntrants.runId, run.id),
        eq(competitionQualificationEntrants.seasonId, seasonId),
      ))
      .orderBy(asc(competitionQualificationEntrants.preliminarySeed)),
    db.select({
      id: matches.id,
      entryAId: matches.entryAId,
      entryBId: matches.entryBId,
      round: matches.round,
      scoreA: matches.scoreA,
      scoreB: matches.scoreB,
      status: matches.status,
      format: matches.format,
      stage: matches.stage,
      ownership: matches.ownership,
      majorStageRunId: matches.majorStageRunId,
      managedKey: matches.managedKey,
      bracketNodeId: matches.bracketNodeId,
    }).from(matches)
      .where(and(eq(matches.seasonId, seasonId), eq(matches.qualificationRunId, run.id)))
      .orderBy(asc(matches.round), asc(matches.id)),
  ]);

  return buildQualificationSwissReadModel({
    directEntryCount: run.directEntryCount,
    entrants,
    matches: linkedMatches,
  });
}

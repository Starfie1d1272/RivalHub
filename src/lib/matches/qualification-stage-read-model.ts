import { withDisplayScores } from "./display-score-data";
import { requireCompetitionFields } from "./competition-context";
import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  competitionEntries,
  competitionQualificationEntrants,
  competitionQualificationRuns,
  matches,
  type CompetitionQualificationRun,
} from "@/db/schema";
import type { PublicScheduleMatch } from "./schedule-read";
import { buildQualificationSwissMatchRecord, buildQualificationSwissReadModel } from "@/lib/competition-qualification/presentation";

export async function loadQualificationSwissStageReadModel(seasonId: string, supplied?: {
  run: CompetitionQualificationRun;
  displayedMatches: readonly (PublicScheduleMatch & { displayScore: import("./display-score").DisplayScore })[];
}) {
  const run = supplied ? supplied.run : (await db.select().from(competitionQualificationRuns)
    .where(eq(competitionQualificationRuns.seasonId, seasonId)).limit(1))[0];
  if (!run || run.seasonId !== seasonId || run.format !== "short_swiss_2w2l") return null;

  const [entrants, linkedMatches] = await Promise.all([
    db.select({
      entryId: competitionQualificationEntrants.competitionEntryId,
      teamName: competitionEntries.name,
      logoUrl: competitionEntries.logoUrl,
      preliminarySeed: competitionQualificationEntrants.preliminarySeed,
    }).from(competitionQualificationEntrants)
      .innerJoin(competitionEntries, eq(competitionEntries.id, competitionQualificationEntrants.competitionEntryId))
      .where(and(
        eq(competitionQualificationEntrants.runId, run.id),
        eq(competitionQualificationEntrants.seasonId, seasonId),
      ))
      .orderBy(asc(competitionQualificationEntrants.preliminarySeed)),
    supplied ? Promise.resolve(supplied.displayedMatches.filter(match =>
      match.seasonId === seasonId && match.qualificationRunId === run.id &&
      match.stage === "play-in" && match.ownership === "manual" && match.majorStageRunId === null &&
      match.managedKey === null && match.bracketNodeId === null,
    ).map(match => requireCompetitionFields(match))) : db.select({
      id: matches.id,
      entryAId: matches.entryAId,
      entryBId: matches.entryBId,
      round: matches.round,
      isForfeit: matches.isForfeit,
      resultDisposition: matches.resultDisposition,
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
      .orderBy(asc(matches.round), asc(matches.id))
      .then(rows => withDisplayScores(rows.map(row => requireCompetitionFields(row)))),
  ]);

  return buildQualificationSwissReadModel({
    directEntryCount: run.directEntryCount,
    entrants,
    matches: linkedMatches,
  });
}

/** Internal reader: callers authorize the season before requesting operator context.
 * Keep all frozen pairing facts, without public identities or BO1 display-map reads.
 */
export async function loadQualificationSwissMatchRecord(seasonId: string, matchId: string): Promise<{ stageName: string; record: string } | null> {
  const [run] = await db.select({
    id: competitionQualificationRuns.id,
    format: competitionQualificationRuns.format,
    directEntryCount: competitionQualificationRuns.directEntryCount,
  }).from(competitionQualificationRuns).where(eq(competitionQualificationRuns.seasonId, seasonId)).limit(1);
  if (!run || run.format !== "short_swiss_2w2l") return null;

  const [entrants, linkedMatches] = await Promise.all([
    db.select({
      entryId: competitionQualificationEntrants.competitionEntryId,
      preliminarySeed: competitionQualificationEntrants.preliminarySeed,
    }).from(competitionQualificationEntrants).where(and(
      eq(competitionQualificationEntrants.runId, run.id),
      eq(competitionQualificationEntrants.seasonId, seasonId),
    )).orderBy(asc(competitionQualificationEntrants.preliminarySeed)),
    db.select({
      id: matches.id, entryAId: matches.entryAId, entryBId: matches.entryBId,
      round: matches.round, scoreA: matches.scoreA, scoreB: matches.scoreB,
      status: matches.status, format: matches.format, stage: matches.stage,
      ownership: matches.ownership, majorStageRunId: matches.majorStageRunId,
      managedKey: matches.managedKey, bracketNodeId: matches.bracketNodeId,
    }).from(matches).where(and(eq(matches.seasonId, seasonId), eq(matches.qualificationRunId, run.id)))
      .orderBy(asc(matches.round), asc(matches.id)),
  ]);
  return buildQualificationSwissMatchRecord({ directEntryCount: run.directEntryCount, entrants,
    matches: linkedMatches.map(row => requireCompetitionFields(row)) }, matchId);
}

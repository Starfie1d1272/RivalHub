import { requireCompetitionMatch } from "@/lib/matches/competition-context";
import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DB, TxDb } from "@/db/client";
import {
  seasons,
  majorPrestartStates,
  majorTournamentEntrants,
  majorTournamentSeeds,
  majorStageRuns,
  majorStageEntrants,
  competitionEntries,
  matches,
} from "@/db/schema";
import { getStandardMajorDefinition } from "@/lib/major/standard";
import { majorRunPresentationSelection } from "@/lib/major/run-snapshot-query";
import { parseMajorRunPresentation, resolveMajorStagePlanFromPresentations } from "@/lib/major/run-snapshot";
import { validateSeriesScore } from "@/lib/matches/result-rules";
import { projectPredictionStages } from "./stage-projection";
import { AppError, ErrorCode } from "@/lib/errors";
import { SIMULATION_VERSION, type Baseline } from "./types";
import { predictionMatchSelection, type PredictionMatch } from "./match-selection";

export function officialWinner(
  match: Pick<
    typeof matches.$inferSelect,
    | "status"
    | "completedAt"
    | "scoreA"
    | "scoreB"
    | "format"
    | "entryAId"
    | "entryBId"
  >,
): string | null {
  if (
    match.status !== "finished" ||
    !match.completedAt ||
    match.scoreA === null ||
    match.scoreB === null
  )
    return null;
  try {
    validateSeriesScore(match.format, match.scoreA, match.scoreB);
  } catch {
    return null;
  }
  return match.scoreA > match.scoreB ? match.entryAId : match.entryBId;
}
export async function loadBaselineRead(
  db: DB | TxDb,
  seasonId: string,
): Promise<{baseline:Baseline;official:PredictionMatch[]}> {
  const [season] = await db
    .select()
    .from(seasons)
    .where(eq(seasons.id, seasonId));
  if (!season) throw new AppError(ErrorCode.NOT_FOUND, "赛事不存在");
  const runs = await db
    .select({
      id: majorStageRuns.id,
      stageKey: majorStageRuns.stageKey,
      finalizedRound: majorStageRuns.finalizedRound,
      presentationInput: majorRunPresentationSelection(majorStageRuns.ruleSnapshot),
    })
    .from(majorStageRuns)
    .where(eq(majorStageRuns.seasonId, seasonId));
  // Frozen StageRun rules remain readable after live configuration changes.
  const plan = resolveMajorStagePlanFromPresentations(
    runs.length
      ? []
      : getStandardMajorDefinition(season).capabilities.stagePlan,
    runs.map((run) => ({
      stageKey: run.stageKey,
      presentation: parseMajorRunPresentation(run.presentationInput, run.stageKey),
    })),
  );
  const stages = projectPredictionStages(plan);
  const [prestart] = await db
    .select({ seedsConfirmedAt: majorPrestartStates.seedsConfirmedAt })
    .from(majorPrestartStates)
    .where(eq(majorPrestartStates.seasonId, seasonId));
  const teams = prestart?.seedsConfirmedAt
    ? await db
        .select({
          teamId: competitionEntries.id,
          name: competitionEntries.name,
          logoUrl: competitionEntries.logoUrl,
          tournamentSeed: majorTournamentSeeds.seed,
        })
        .from(majorTournamentSeeds)
        .innerJoin(
          majorTournamentEntrants,
          eq(
            majorTournamentEntrants.id,
            majorTournamentSeeds.tournamentEntrantId,
          ),
        )
        .innerJoin(
          competitionEntries,
          eq(competitionEntries.id, majorTournamentEntrants.competitionEntryId),
        )
        .where(eq(majorTournamentSeeds.seasonId, seasonId))
    : [];
  const entrants = await db
    .select({
      runId: majorStageEntrants.stageRunId,
      teamId: majorTournamentEntrants.competitionEntryId,
      seed: majorStageEntrants.stageSeed,
    })
    .from(majorStageEntrants)
    .innerJoin(
      majorTournamentEntrants,
      eq(majorTournamentEntrants.id, majorStageEntrants.tournamentEntrantId),
    )
    .where(eq(majorStageEntrants.seasonId, seasonId));
  const rawOfficial = await db
    .select(predictionMatchSelection)
    .from(matches)
    .where(
      and(eq(matches.seasonId, seasonId), eq(matches.ownership, "major_stage")),
    );
  const official = rawOfficial.map(requireCompetitionMatch);
  const baseline: Baseline = {
    version: SIMULATION_VERSION,
    seasonId,
    name: season.name,
    capturedAt: new Date().toISOString(),
    stages,
    teams,
    runs: runs.map((r) => ({
      id: r.id,
      key: r.stageKey,
      finalizedRound: r.finalizedRound,
      entrants: entrants
        .filter((e) => e.runId === r.id)
        .map((e) => ({ teamId: e.teamId, seed: e.seed }))
        .sort((a, b) => a.seed - b.seed),
    })),
    matches: official
      .filter(
        (m) =>
          m.managedKey &&
          m.entryRound !== "third_place" &&
          runs.some(
            (r) => r.id === m.majorStageRunId && r.stageKey === m.stage,
          ),
      )
      .map((m) => ({
        id: m.id,
        stageKey: m.stage,
        key: m.managedKey!,
        round:
          m.round ??
          (m.entryRound === "quarterfinal"
            ? 1
            : m.entryRound === "semifinal"
              ? 2
              : 3),
        a: m.entryAId,
        b: m.entryBId,
        winner: officialWinner(m),
        scoreA: m.scoreA,
        scoreB: m.scoreB,
        format: m.format,
        status: m.status,
        scheduledAt: m.scheduledAt?.toISOString() ?? null,
      })),
  };
  baseline.revision = createHash("sha256")
    .update(
      JSON.stringify({
        version: baseline.version,
        stages: baseline.stages,
        teams: [...baseline.teams].sort(
          (a, b) => a.tournamentSeed - b.tournamentSeed,
        ),
        runs: [...baseline.runs].sort((a, b) => a.key.localeCompare(b.key)),
        matches: [...baseline.matches].sort((a, b) => a.id.localeCompare(b.id)),
      }),
    )
    .digest("hex");
  return {baseline,official:rawOfficial};
}
export async function loadBaseline(db: DB | TxDb, seasonId: string): Promise<Baseline> {
  return (await loadBaselineRead(db,seasonId)).baseline;
}

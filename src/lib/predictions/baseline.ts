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
import { parseMajorRunSnapshot } from "@/lib/major/run-snapshot";
import { validateSeriesScore } from "@/lib/matches/result-rules";
import { AppError, ErrorCode } from "@/lib/errors";
import { SIMULATION_VERSION, type Baseline, type PublicStage } from "./types";

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
export async function loadBaseline(
  db: DB | TxDb,
  seasonId: string,
): Promise<Baseline> {
  const [season] = await db
    .select()
    .from(seasons)
    .where(eq(seasons.id, seasonId));
  if (!season) throw new AppError(ErrorCode.NOT_FOUND, "赛事不存在");
  const definition = getStandardMajorDefinition(season);
  const runs = await db
    .select()
    .from(majorStageRuns)
    .where(eq(majorStageRuns.seasonId, seasonId));
  const firstRun = [...runs].sort(
    (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
  )[0];
  const plan = firstRun
    ? parseMajorRunSnapshot(firstRun.ruleSnapshot, firstRun.stageKey).stagePlan
    : definition.capabilities.stagePlan;
  const stages: PublicStage[] = plan.map((s) => {
    if (
      (s.type !== "swiss" && s.type !== "single_elim") ||
      (s.matchFormat !== "bo1" && s.matchFormat !== "bo3")
    )
      throw new AppError(
        ErrorCode.SEASON_CAPABILITY_DISABLED,
        "暂不支持该阶段规则",
      );
    return {
      key: s.key,
      name: s.name,
      type: s.type,
      matchFormat: s.matchFormat,
      entrySeeds: s.entrySeeds ?? 0,
      finalFormat: s.finalFormat === "bo5" ? "bo5" : null,
    };
  });
  const [prestart] = await db
    .select()
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
  const official = await db
    .select()
    .from(matches)
    .where(
      and(eq(matches.seasonId, seasonId), eq(matches.ownership, "major_stage")),
    );
  const baseline: Baseline = {
    version: SIMULATION_VERSION,
    seasonId,
    name: season.name,
    capturedAt: new Date().toISOString(),
    stages,
    teams,
    runs: runs.map((r) => ({
      key: r.stageKey,
      finalizedRound: r.finalizedRound,
      entrants: entrants
        .filter((e) => e.runId === r.id)
        .map((e) => ({ teamId: e.teamId, seed: e.seed }))
        .sort((a, b) => a.seed - b.seed),
    })),
    matches: official
      .filter((m) => m.managedKey && m.entryRound !== "third_place")
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
  return baseline;
}

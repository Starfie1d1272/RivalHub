import { assertCompetitionMatch } from "@/lib/matches/competition-context";
import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { competitionQualificationRuns, competitionQualificationEntrants, majorFinalResults, majorStageRuns, matches, seasons, type Match } from "@/db/schema";
import { loadStageBracketNodeViews, loadStageBracketViews } from "@/lib/bracket";
import { planCompetitionQualificationResultCorrectionInTx } from "@/lib/competition-qualification/runtime";
import { normalizeStagePlan } from "@/lib/seasons/compatibility";
import { classifyDownstreamManagedMatches, loadFrozenRunFacts } from "./service";

/** Completion is narrower than historical winner recovery: pre-existing
 * downstream facts are blocked, never erased. Season lock serializes stage
 * materialization; downstream row locks serialize their starts/results. */
export async function planSeriesCompletionProgressionInTx(tx: TxDb, match: Match) {
  assertCompetitionMatch(match);
  const blockers: string[] = [];
  const season = await tx.query.seasons.findFirst({ where: eq(seasons.id, match.seasonId) });
  const allMatches = await tx.select().from(matches).where(eq(matches.seasonId, match.seasonId)).orderBy(asc(matches.id));
  let ownerFacts: unknown = { season, allMatches };
  const downstreamIds = new Set<string>();
  let mode: "qualification" | "major" | "bracket" | "manual" = "manual";
  const [final] = await tx.select({ id: majorFinalResults.id }).from(majorFinalResults).where(eq(majorFinalResults.seasonId, match.seasonId));
  if (final) blockers.push("赛事最终结果已确认，请先处理赛后裁定。");
  if (match.qualificationRunId) {
    mode = "qualification";
    const plan = await planCompetitionQualificationResultCorrectionInTx(tx, { seasonId: match.seasonId, runId: match.qualificationRunId, matchId: match.id, round: match.round, sourceStatus: "in_progress" });
    for (const row of plan.downstreamMatches) downstreamIds.add(row.matchId);
    ownerFacts = { season, allMatches, run: await tx.query.competitionQualificationRuns.findFirst({ where: eq(competitionQualificationRuns.id, match.qualificationRunId) }), entrants: await tx.select().from(competitionQualificationEntrants).where(eq(competitionQualificationEntrants.runId, match.qualificationRunId)).orderBy(asc(competitionQualificationEntrants.id)) };
    if (plan.finalMainEntrantsExist) blockers.push("资格赛已确认正赛参赛队，请先处理已推进的赛事事实。");
  } else if (match.majorStageRunId) {
    mode = "major";
    const runs = await tx.select().from(majorStageRuns).where(eq(majorStageRuns.seasonId, match.seasonId)).for("update");
    const run = runs.find(row => row.id === match.majorStageRunId);
    if (!run) throw new Error("Managed match has no StageRun");
    const frozen = loadFrozenRunFacts(run);
    ownerFacts = { season, allMatches, runs };
    for (const row of classifyDownstreamManagedMatches(allMatches.filter(row => row.majorStageRunId === run.id), match, frozen.stageType)) downstreamIds.add(row.matchId);
    const myIndex = frozen.stagePlanKeys.indexOf(match.stage);
    if (myIndex < 0) blockers.push("阶段记录不完整，请先核对赛程。");
    if (runs.some(row => row.id !== run.id && frozen.stagePlanKeys.indexOf(row.stageKey) > myIndex)) blockers.push("后续阶段已生成，请先处理已推进的赛事事实。");
    if (frozen.stageType === "swiss" && run.finalizedRound >= (match.round ?? 0)) blockers.push("本轮已确认晋级，请先处理已推进的赛事事实。");
  } else if (match.bracketNodeId) {
    mode = "bracket";
    const view = (await loadStageBracketViews(tx, match.seasonId)).get(match.stage);
    ownerFacts = { season, allMatches, view };
    const independent = view?.stage[0]?.type === "round_robin" && view.match.some(row => String(row.id) === match.bracketNodeId);
    const nodes = (await loadStageBracketNodeViews(tx, match.seasonId)).get(match.stage) ?? [];
    const source = nodes.find(row => row.id === match.bracketNodeId);
    if (!source && !independent) blockers.push("晋级关系无法核对，请先处理赛程记录。");
    const ids = new Set<string>();
    const visit = (id: string | null) => {
      if (!id || ids.has(id)) return;
      ids.add(id);
      const node = nodes.find(row => row.id === id);
      if (!node) { blockers.push("晋级关系无法核对，请先处理赛程记录。"); return; }
      visit(node.nextWinNodeId); visit(node.nextLossNodeId);
    };
    if (source) { visit(source.nextWinNodeId); visit(source.nextLossNodeId); }
    for (const row of allMatches) if (row.stage === match.stage && row.bracketNodeId && ids.has(row.bracketNodeId)) downstreamIds.add(row.id);
  }
  // Cross-stage facts matter even for a provider/manual stage.
  const plan = normalizeStagePlan(season?.stagePlan);
  const index = plan.findIndex(row => row.key === match.stage);
  if (index >= 0) for (const row of allMatches) if (plan.findIndex(stage => stage.key === row.stage) > index) downstreamIds.add(row.id);
  const downstream = downstreamIds.size ? await tx.select().from(matches).where(inArray(matches.id, [...downstreamIds])).orderBy(asc(matches.id)).for("update") : [];
  if (downstream.some(row => row.status !== "scheduled" || row.startedAt || row.completedAt || row.scoreA !== null)) blockers.push("下游比赛已开始或已有正式结果，请先处理实际比赛事实。");
  else if (downstream.length) blockers.push("后续赛程已生成，请先通过赛程恢复处理后再更正。");
  return { mode, downstream, blockers, ownerFacts };
}

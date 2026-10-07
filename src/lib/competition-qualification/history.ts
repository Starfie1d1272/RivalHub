import { assertCompetitionMatch, requireCompetitionMatch } from "@/lib/matches/competition-context";
import type {
  matches,
  competitionQualificationRuns,
  competitionQualificationEntrants,
} from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import type { SwissCompletedMatch, SwissEntrant } from "@/lib/swiss/types";
import {
  isShortSwissQualificationAllowed,
  SHORT_SWISS_MAX_ROUNDS,
} from "./policy";
import {
  generateShortSwissRoundPairings,
  projectShortSwissStage,
  type QualificationPairing,
} from "./swiss";
type QualificationRun = typeof competitionQualificationRuns.$inferSelect;
type QualificationEntrant =
  typeof competitionQualificationEntrants.$inferSelect;
export function playInSwissEntrants(
  entrants: readonly QualificationEntrant[],
  directEntryCount: number,
): SwissEntrant[] {
  return entrants
    .filter((entrant) => entrant.preliminarySeed > directEntryCount)
    .map((entrant) => ({
      teamId: entrant.competitionEntryId,
      initialSeed: entrant.preliminarySeed - directEntryCount,
    }));
}

export function winnerFromMatch(match: typeof matches.$inferSelect): string {
  assertCompetitionMatch(match);
  if (
    match.scoreA === null ||
    match.scoreB === null ||
    match.scoreA === match.scoreB
  ) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      `Play-in 比赛 ${match.id} 缺少有效胜者。`,
    );
  }
  return match.scoreA > match.scoreB ? match.entryAId : match.entryBId;
}

export function swissFactsFromMatches(
  rows: readonly (typeof matches.$inferSelect)[],
  throughRound: number,
): SwissCompletedMatch[] {
  return rows.map(requireCompetitionMatch)
    .filter(
      (match) =>
        match.round !== null &&
        match.round <= throughRound &&
        match.status === "finished",
    )
    .map((match) => ({
      matchId: match.id,
      round: match.round!,
      entryAId: match.entryAId,
      entryBId: match.entryBId,
      winnerId: winnerFromMatch(match),
    }));
}

function toPairingFacts(
  pairings: readonly QualificationPairing[],
): Array<{ pairKey: string; pairing: QualificationPairing }> {
  return pairings.map((pairing) => ({
    pairKey: [pairing.higherSeedTeamId, pairing.lowerSeedTeamId]
      .sort()
      .join(":"),
    pairing,
  }));
}

function matchPairKey(match: typeof matches.$inferSelect): string {
  return [match.entryAId, match.entryBId].sort().join(":");
}

export function validatePersistedRound(
  matchesInRound: readonly (typeof matches.$inferSelect)[],
  pairings: readonly QualificationPairing[],
  format: "bo1" | "bo3",
  runId: string,
): void {
  const expected = toPairingFacts(pairings);
  const actual = matchesInRound.map((match) => matchPairKey(match));
  if (
    actual.length !== expected.length ||
    new Set(actual).size !== actual.length ||
    actual.some((key) => !expected.some((row) => row.pairKey === key)) ||
    matchesInRound.some(
      (match) =>
        match.round !== pairings[0]?.round ||
        match.format !== format ||
        match.stage !== "play-in" ||
        match.qualificationRunId !== runId ||
        match.ownership !== "manual" ||
        match.majorStageRunId !== null ||
        match.managedKey !== null ||
        match.bracketNodeId !== null,
    )
  ) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      "Play-in 已生成轮次与当前种子或规则不一致，拒绝继续。",
    );
  }
}

export function assertCandidateSet(
  entrants: readonly QualificationEntrant[],
  expectedIds: readonly string[],
): void {
  const entrantIds = entrants.map((entrant) => entrant.competitionEntryId);
  if (
    entrants.length !== expectedIds.length ||
    new Set(expectedIds).size !== expectedIds.length ||
    expectedIds.some((id) => !entrantIds.includes(id))
  ) {
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      "报名候选队伍集合已变化，请刷新后重试。",
    );
  }
  if (
    entrants.some((entrant, index) => entrant.preliminarySeed !== index + 1)
  ) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      "Play-in 预排名不连续，拒绝生成比赛。",
    );
  }
}

export function assertRunSnapshot(
  run: QualificationRun,
  entrants: readonly QualificationEntrant[],
): void {
  assertCandidateSet(
    entrants,
    entrants.map((entrant) => entrant.competitionEntryId),
  );
  const qualifierCount = run.candidateCount - run.targetEntrantCount;
  if (
    entrants.length !== run.candidateCount ||
    qualifierCount < 1 ||
    run.directEntryCount !== run.targetEntrantCount - qualifierCount ||
    run.qualifierCount !== qualifierCount ||
    run.playInEntryCount !== qualifierCount * 2 ||
    run.candidateCount !== run.directEntryCount + run.playInEntryCount ||
    (run.format === "short_swiss_2w2l" &&
      !isShortSwissQualificationAllowed(run.playInEntryCount))
  ) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      "Play-in 运行配置与冻结候选集合不一致。",
    );
  }
}

export function validateShortSwissHistory(
  run: QualificationRun,
  entrants: readonly QualificationEntrant[],
  linkedMatches: readonly (typeof matches.$inferSelect)[],
): {
  completedRound: number;
  projection: ReturnType<typeof projectShortSwissStage>;
} {
  const swissEntrants = playInSwissEntrants(entrants, run.directEntryCount);
  const rounds = new Map<number, (typeof linkedMatches)[number][]>();
  for (const match of linkedMatches) {
    if (
      match.round === null ||
      match.round < 1 ||
      match.round > SHORT_SWISS_MAX_ROUNDS
    ) {
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        "Short Swiss Play-in 比赛轮次无效。",
      );
    }
    const rows = rounds.get(match.round) ?? [];
    rows.push(match);
    rounds.set(match.round, rows);
  }
  const facts: SwissCompletedMatch[] = [];
  let completedRound = 0;
  let projection = projectShortSwissStage({
    entrants: swissEntrants,
    matches: facts,
    completedRound,
  });
  for (let round = 1; round <= SHORT_SWISS_MAX_ROUNDS; round += 1) {
    const rows = rounds.get(round) ?? [];
    if (rows.length === 0) break;
    const pairings = generateShortSwissRoundPairings({
      entrants: swissEntrants,
      matches: facts,
      completedRound,
    });
    validatePersistedRound(rows, pairings, "bo1", run.id);
    if (rows.some((match) => match.status !== "finished")) {
      if ([...rounds.keys()].some((futureRound) => futureRound > round)) {
        throw new AppError(
          ErrorCode.INTERNAL_ERROR,
          "前一轮未完成时已存在后续 Play-in 轮次。",
        );
      }
      break;
    }
    facts.push(...swissFactsFromMatches(rows, round));
    completedRound = round;
    projection = projectShortSwissStage({
      entrants: swissEntrants,
      matches: facts,
      completedRound,
    });
  }
  if ([...rounds.keys()].some((round) => round > completedRound + 1)) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      "Short Swiss Play-in 存在跳轮比赛。",
    );
  }
  return { completedRound, projection };
}

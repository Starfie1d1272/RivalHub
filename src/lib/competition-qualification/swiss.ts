import { projectSwissStage } from "@/lib/swiss/core";
import { groupSwissByRecord, pairSwissHighLowZeroRematch, pairSwissTopHalfBottomHalf } from "@/lib/swiss/pairing";
import type { SwissCompletedMatch, SwissEntrant, SwissPair, SwissProjection } from "@/lib/swiss/types";
import {
  SHORT_SWISS_LOSS_THRESHOLD,
  SHORT_SWISS_MAX_ROUNDS,
  SHORT_SWISS_WIN_THRESHOLD,
} from "./policy";

export interface QualificationPairing {
  round: number;
  record: { wins: number; losses: number };
  higherSeedTeamId: string;
  lowerSeedTeamId: string;
  higherSeed: number;
  lowerSeed: number;
}

const shortSwissConfig = {
  winThreshold: SHORT_SWISS_WIN_THRESHOLD,
  lossThreshold: SHORT_SWISS_LOSS_THRESHOLD,
} as const;

/** Short Swiss owns complete-round and same-record pairing policy. */
export function projectShortSwissStage(input: {
  entrants: readonly SwissEntrant[];
  matches: readonly SwissCompletedMatch[];
  completedRound: number;
}): SwissProjection {
  if (input.completedRound > SHORT_SWISS_MAX_ROUNDS) {
    throw new Error(`Short Swiss completedRound must be at most ${SHORT_SWISS_MAX_ROUNDS}`);
  }
  const projection = projectSwissStage({ ...input, config: shortSwissConfig });
  for (let round = 1; round <= input.completedRound; round += 1) {
    const beforeRound = projectSwissStage({
      entrants: input.entrants,
      matches: input.matches.filter((match) => match.round < round),
      completedRound: round - 1,
      config: shortSwissConfig,
    });
    const activeIds = new Set(beforeRound.active.map((team) => team.teamId));
    const teamById = new Map(beforeRound.teams.map((team) => [team.teamId, team]));
    const roundMatches = input.matches.filter((match) => match.round === round);
    const participants = new Set<string>();
    for (const match of roundMatches) {
      if (participants.has(match.entryAId) || participants.has(match.entryBId)) {
        throw new Error(`Short Swiss round ${round} includes a team more than once`);
      }
      participants.add(match.entryAId);
      participants.add(match.entryBId);
      const teamA = teamById.get(match.entryAId);
      const teamB = teamById.get(match.entryBId);
      if (!teamA || !teamB || teamA.status !== "active" || teamB.status !== "active") {
        throw new Error(`Short Swiss round ${round} includes a non-active team`);
      }
      if (teamA.wins !== teamB.wins || teamA.losses !== teamB.losses) {
        throw new Error(`Short Swiss round ${round} match ${match.matchId} is cross-record`);
      }
    }
    if (participants.size !== activeIds.size || [...activeIds].some((teamId) => !participants.has(teamId))) {
      throw new Error(`Short Swiss completed round ${round} must pair every active team exactly once`);
    }
  }
  return projection;
}

/** Direct BO3 uses a mirror draw: P1 vs Pn, P2 vs P(n-1), and so on. */
export function generateDirectBo3QualificationPairings(
  entrants: readonly SwissEntrant[],
): readonly QualificationPairing[] {
  const ordered = [...entrants].sort((a, b) => a.initialSeed - b.initialSeed);
  if (ordered.length < 2 || ordered.length % 2 !== 0 ||
      ordered.some((entrant, index) => entrant.initialSeed !== index + 1)) {
    throw new Error("Direct BO3 requires an even, consecutively seeded Play-in field");
  }
  return Array.from({ length: ordered.length / 2 }, (_, index) => {
    const higher = ordered[index]!;
    const lower = ordered[ordered.length - 1 - index]!;
    return {
      round: 1,
      record: { wins: 0, losses: 0 },
      higherSeedTeamId: higher.teamId,
      lowerSeedTeamId: lower.teamId,
      higherSeed: higher.initialSeed,
      lowerSeed: lower.initialSeed,
    };
  });
}

/** Qualification-only rules layered over the generic Swiss projection and pairing core. */
export function generateShortSwissRoundPairings(input: {
  entrants: readonly SwissEntrant[];
  matches: readonly SwissCompletedMatch[];
  completedRound: number;
}): readonly QualificationPairing[] {
  const projection = projectShortSwissStage(input);
  if (projection.isComplete) throw new Error("Play-in 已完成，没有待生成的轮次。");
  const round = input.completedRound + 1;
  const pairings: QualificationPairing[] = [];
  for (const group of groupSwissByRecord(projection.active)) {
    const pairs: readonly SwissPair[] = round === 1
      ? pairSwissTopHalfBottomHalf(group.teams)
      : pairSwissHighLowZeroRematch(group.teams);
    for (const pair of pairs) {
      pairings.push({
        round,
        record: group.record,
        higherSeedTeamId: pair.higherSeedTeamId,
        lowerSeedTeamId: pair.lowerSeedTeamId,
        higherSeed: pair.higherSeed,
        lowerSeed: pair.lowerSeed,
      });
    }
  }
  const pairedIds = new Set(pairings.flatMap((pair) => [pair.higherSeedTeamId, pair.lowerSeedTeamId]));
  if (pairedIds.size !== projection.active.length) {
    throw new Error("当前 Swiss 战绩组无法形成完整且不重赛的配对。");
  }
  return pairings;
}

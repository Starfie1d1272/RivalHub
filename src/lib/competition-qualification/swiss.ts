import { projectSwissStage } from "@/lib/swiss/core";
import { groupSwissByRecord, pairSwissHighLowZeroRematch, pairSwissTopHalfBottomHalf } from "@/lib/swiss/pairing";
import type { SwissCompletedMatch, SwissEntrant, SwissPair } from "@/lib/swiss/types";

export interface QualificationPairing {
  round: number;
  record: { wins: number; losses: number };
  higherSeedTeamId: string;
  lowerSeedTeamId: string;
  higherSeed: number;
  lowerSeed: number;
}

/** Qualification-only rules layered over the generic Swiss projection and pairing core. */
export function generateShortSwissRoundPairings(input: {
  entrants: readonly SwissEntrant[];
  matches: readonly SwissCompletedMatch[];
  completedRound: number;
}): readonly QualificationPairing[] {
  const projection = projectSwissStage({ ...input, config: { winThreshold: 2, lossThreshold: 2 } });
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

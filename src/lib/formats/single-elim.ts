import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { matches } from "@/db/schema";
import { createStageBracket, ensureResolvedBracketMatch, saveStageBracketState } from "@/lib/bracket";
import type { StageExecutor } from "./types";
import type { QualifiedTeam } from "@/types/season";
import { isStageComplete } from "./_shared";

const ENTRY_ROUNDS = [
  "round_of_32",
  "round_of_16",
  "quarterfinal",
  "semifinal",
  "final",
] as const;

function mapRoundToEntryRound(roundNumber: number, bracketSize: number): string | null {
  const totalRounds = Math.log2(bracketSize);
  if (roundNumber < 1 || roundNumber > totalRounds) return null;
  const index = Math.max(0, ENTRY_ROUNDS.length - totalRounds + roundNumber - 1);
  return ENTRY_ROUNDS[index] ?? null;
}

function nextPowerOfTwo(n: number): number {
  let power = 1;
  while (power < n) power <<= 1;
  return power;
}

export const singleElimExecutor: StageExecutor = {
  async initialize(seasonId, config, entries) {
    const { data, resolvedMatches } = await createStageBracket(config, entries);
    const bracketSize = nextPowerOfTwo(config.teamCount);
    for (const resolved of resolvedMatches) {
      await ensureResolvedBracketMatch(db, {
        seasonId,
        stageKey: config.key,
        resolved,
        format: config.matchFormat ?? "bo3",
        entryRound: mapRoundToEntryRound(resolved.roundNumber, bracketSize),
      });
    }
    await saveStageBracketState(db, seasonId, config.key, data);
    return { matchCount: resolvedMatches.length };
  },

  async isComplete(seasonId, stageKey) {
    return isStageComplete(seasonId, stageKey);
  },

  async getQualifiers(seasonId, config) {
    const stageMatches = await db.query.matches.findMany({
      where: and(
        eq(matches.seasonId, seasonId),
        eq(matches.stage, config.key),
        eq(matches.status, "finished"),
      ),
    });
    if (stageMatches.length === 0) return [];

    const finalMatch = stageMatches.find((match) => match.entryRound === "final");
    if (!finalMatch || finalMatch.scoreA === null || finalMatch.scoreB === null || finalMatch.scoreA === finalMatch.scoreB) {
      return [];
    }
    const winnerId = finalMatch.scoreA > finalMatch.scoreB ? finalMatch.entryAId : finalMatch.entryBId;
    const loserId = finalMatch.scoreA > finalMatch.scoreB ? finalMatch.entryBId : finalMatch.entryAId;
    const result: QualifiedTeam[] = [{ teamId: winnerId, placement: "1st" }];
    if (config.advanceTiers.some((tier) => tier.placement === "2nd")) {
      result.push({ teamId: loserId, placement: "2nd" });
    }
    return result;
  },
};

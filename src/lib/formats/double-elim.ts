import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { matches } from "@/db/schema";
import { createStageBracket, ensureResolvedBracketMatch, saveStageBracketState } from "@/lib/bracket";
import type { StageExecutor } from "./types";
import type { QualifiedTeam } from "@/types/season";
import { isStageComplete } from "./_shared";

export const doubleElimExecutor: StageExecutor = {
  async initialize(seasonId, config, entries) {
    const { data, resolvedMatches } = await createStageBracket(config, entries);
    for (const resolved of resolvedMatches) {
      await ensureResolvedBracketMatch(db, {
        seasonId,
        stageKey: config.key,
        resolved,
        format: config.matchFormat ?? "bo3",
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
      orderBy: (match, { desc: orderDesc }) => [orderDesc(match.createdAt)],
    });
    if (stageMatches.length === 0) return [];

    // Provider-driven matches are inserted as their nodes become resolved;
    // the latest completed match is the terminal grand-final result.
    const finalMatch = stageMatches[0];
    if (finalMatch.scoreA === null || finalMatch.scoreB === null || finalMatch.scoreA === finalMatch.scoreB) {
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

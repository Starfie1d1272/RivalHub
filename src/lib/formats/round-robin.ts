import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { matches, competitionEntries } from "@/db/schema";
import { calculateStandings } from "@/lib/standings";
import { getMatchMapRoundScores } from "@/lib/data/standings";
import { createStageBracket, ensureResolvedBracketMatch, loadStageBracketState, saveStageBracketState, type BracketParticipantRef } from "@/lib/bracket";
import type { StageExecutor } from "./types";
import { isStageComplete } from "./_shared";

export const roundRobinExecutor: StageExecutor = {
  async initialize(seasonId, config, entries) {
    const { data, resolvedMatches } = await createStageBracket(config, entries);
    for (const resolved of resolvedMatches) {
      await ensureResolvedBracketMatch(db, { seasonId, stageKey: config.key, resolved, format: "bo1" });
    }
    await saveStageBracketState(db, seasonId, config.key, data);
    return { matchCount: resolvedMatches.length };
  },

  async isComplete(seasonId, stageKey) {
    return isStageComplete(seasonId, stageKey);
  },

  async getQualifiers(seasonId, config) {
    const state = await loadStageBracketState(db, seasonId, config.key);
    const stageEntryIds = state
      ? (state.participant as unknown as BracketParticipantRef[]).map((participant) => participant.rivalhubEntryId)
      : [];
    if (stageEntryIds.length === 0) return [];
    const entries = await db.query.competitionEntries.findMany({
      where: and(
        eq(competitionEntries.competitionId, seasonId),
        inArray(competitionEntries.id, stageEntryIds),
      ),
    });
    const teamById = new Map(entries.map((entry) => [entry.id, entry]));
    const seasonTeams = stageEntryIds.map((entryId) => teamById.get(entryId)).filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
    const finishedMatches = await db.query.matches.findMany({
      where: and(
        eq(matches.seasonId, seasonId),
        eq(matches.stage, config.key),
        eq(matches.status, "finished"),
      ),
    });
    const roundScores = await getMatchMapRoundScores(finishedMatches.map((match) => match.id));
    const standings = calculateStandings(seasonTeams, finishedMatches, roundScores);
    const advanceCount = config.advanceTiers.reduce((sum, tier) => sum + tier.count, 0);
    return standings.slice(0, advanceCount).map((standing) => ({
      teamId: standing.teamId,
      placement: "*",
    }));
  },
};

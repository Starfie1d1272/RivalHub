import { and, count, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { matches, seasons, teams } from "@/db/schema";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { generateBracket } from "@/lib/bracket";
import { calculateStandings } from "@/lib/standings";
import { getFirstStageOfType, normalizeStagePlan } from "@/types/season";
import type { QualifiedTeam } from "@/types/season";
import type { StageExecutor } from "./types";
import type { Database } from "brackets-manager";

export const roundRobinExecutor: StageExecutor = {
  async initialize(seasonId, config, teams, _qualifiers) {
    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, seasonId),
    });
    if (!season) {
      throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
    }

    const playoffStage = getFirstStageOfType(
      normalizeStagePlan(season.stagePlan),
      ["double_elim", "single_elim"],
    );
    const { data, resolvedMatches } = await generateBracket(teams, {
      qualifierFormat: "round_robin",
      playoffFormat: playoffStage
        ? (playoffStage.type === "double_elim" ? "double_elim" : "single_elim")
        : null,
      qualifierName: config.name,
      playoffName: playoffStage?.name,
    });

    const bracketStages = data.stage as Array<{ id: number; name: string }>;
    const stageId = bracketStages.find((stage) => stage.name === config.name)?.id ?? null;
    let matchCount = 0;

    for (const bm of resolvedMatches) {
      if (stageId !== null && bm.stageId !== stageId) continue;
      const teamA = teams[bm.teamAParticipantId];
      const teamB = teams[bm.teamBParticipantId];
      if (!teamA || !teamB) continue;

      await db.insert(matches).values({
        seasonId,
        teamAId: teamA.id,
        teamBId: teamB.id,
        stage: config.key,
        format: "bo1",
        status: "scheduled",
        bracketNodeId: bm.bracketMatchId.toString(),
      });
      matchCount++;
    }

    await db
      .update(seasons)
      .set({ bracketData: data as Database, updatedAt: new Date() })
      .where(eq(seasons.id, seasonId));

    return { matchCount };
  },

  async isComplete(seasonId, stageKey) {
    const [{ value: total }] = await db
      .select({ value: count() })
      .from(matches)
      .where(and(eq(matches.seasonId, seasonId), eq(matches.stage, stageKey)));
    if (total === 0) return false;

    const [{ value: active }] = await db
      .select({ value: count() })
      .from(matches)
      .where(
        and(
          eq(matches.seasonId, seasonId),
          eq(matches.stage, stageKey),
          sql`${matches.status} in ('scheduled', 'in_progress')`,
        ),
      );
    return active === 0;
  },

  async getQualifiers(seasonId, config) {
    const seasonTeams = await db.query.teams.findMany({
      where: eq(teams.seasonId, seasonId),
    });
    const standings = await calculateStandings(seasonId, seasonTeams, config.key);
    const advanceCount = config.advanceTiers.reduce((sum, t) => sum + t.count, 0);
    return standings.slice(0, advanceCount).map((s) => ({
      teamId: s.teamId,
      placement: "*",
    }));
  },
};

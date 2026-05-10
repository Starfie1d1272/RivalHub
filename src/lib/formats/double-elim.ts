import { and, count, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { matches, seasons } from "@/db/schema";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { generateBracket, seedPlayoff } from "@/lib/bracket";
import { calculateStandings } from "@/lib/standings";
import { getPreviousStage, normalizeStagePlan } from "@/types/season";
import type { StageExecutor } from "./types";
import type { Database } from "brackets-manager";
import type { QualifiedTeam } from "@/types/season";

export const doubleElimExecutor: StageExecutor = {
  async initialize(seasonId, config, teams, _qualifiers) {
    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, seasonId),
    });
    if (!season) {
      throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
    }

    const stagePlan = normalizeStagePlan(season.stagePlan);
    const previousStage = getPreviousStage(stagePlan, config.key);
    const playoffFormat = config.type === "double_elim" ? "double_elim" : "single_elim";

    if (!previousStage) {
      const { data, resolvedMatches } = await generateBracket(teams, {
        qualifierFormat: null,
        playoffFormat,
        playoffName: config.name,
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
          format: "bo3",
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
    }

    if (!season.bracketData) {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "请先一键生成赛程");
    }

    const standings = await calculateStandings(seasonId, teams, previousStage.key);
    const seededNames = standings.slice(0, config.teamCount).map((standing) => standing.teamName);
    const { updatedData, resolvedMatches } = await seedPlayoff(
      seededNames,
      season.bracketData as Database,
      config.name,
    );

    await db
      .update(seasons)
      .set({ bracketData: updatedData as Database, updatedAt: new Date() })
      .where(eq(seasons.id, seasonId));

    const nameToTeam = new Map(teams.map((team) => [team.name, team]));
    const participants = updatedData.participant as Array<{ id: number; name: string }>;
    const participantIdToTeam = new Map(
      participants.map((participant) => [participant.id, nameToTeam.get(participant.name)]),
    );
    const bracketStages = updatedData.stage as Array<{ id: number; name: string }>;
    const stageId = bracketStages.find((stage) => stage.name === config.name)?.id ?? null;
    let matchCount = 0;

    for (const bm of resolvedMatches) {
      if (stageId === null || bm.stageId !== stageId) continue;
      const teamA = participantIdToTeam.get(bm.teamAParticipantId);
      const teamB = participantIdToTeam.get(bm.teamBParticipantId);
      if (!teamA || !teamB) continue;

      await db.insert(matches).values({
        seasonId,
        teamAId: teamA.id,
        teamBId: teamB.id,
        stage: config.key,
        format: "bo3",
        status: "scheduled",
        bracketNodeId: bm.bracketMatchId.toString(),
      });
      matchCount++;
    }

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

  async getQualifiers(_seasonId, _config) {
    return [];
  },
};

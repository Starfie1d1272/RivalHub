import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { matches, seasons } from "@/db/schema";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { generateBracket, seedPlayoff, type BracketStageRef, type BracketParticipantRef } from "@/lib/bracket";
import { calculateStandings } from "@/lib/standings";
import { getPreviousStage, normalizeStagePlan } from "@/types/season";
import type { StageExecutor } from "./types";
import type { Database } from "brackets-manager";
import type { QualifiedTeam } from "@/types/season";
import { isStageComplete } from "./_shared";

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
      const bracketStages = data.stage as BracketStageRef[];
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

    const finishedMatches = await db.query.matches.findMany({
      where: and(
        eq(matches.seasonId, seasonId),
        eq(matches.stage, previousStage.key),
        eq(matches.status, "finished"),
      ),
    });
    const standings = calculateStandings(teams, finishedMatches);
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
    const participants = updatedData.participant as BracketParticipantRef[];
    const participantIdToTeam = new Map(
      participants.map((participant) => [participant.id, nameToTeam.get(participant.name)]),
    );
    const bracketStages = updatedData.stage as BracketStageRef[];
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
    return isStageComplete(seasonId, stageKey);
  },

  async getQualifiers(seasonId, config) {
    const stageMatches = await db.query.matches.findMany({
      where: and(
        eq(matches.seasonId, seasonId),
        eq(matches.stage, config.key),
        eq(matches.status, "finished"),
      ),
      orderBy: (matches, { desc }) => [desc(matches.createdAt)],
    });

    if (stageMatches.length === 0) return [];

    // createdAt 倒序：双败淘汰的场次动态插入，最后插入的即大决赛（含 bracket reset）。
    const finalMatch = stageMatches[0];

    if (finalMatch.scoreA === null || finalMatch.scoreB === null) return [];
    if (finalMatch.scoreA === finalMatch.scoreB) return [];

    const winnerId = finalMatch.scoreA > finalMatch.scoreB ? finalMatch.teamAId : finalMatch.teamBId;
    const loserId = finalMatch.scoreA > finalMatch.scoreB ? finalMatch.teamBId : finalMatch.teamAId;

    const result: QualifiedTeam[] = [{ teamId: winnerId, placement: "1st" }];

    if (config.advanceTiers.some((t) => t.placement === "2nd")) {
      result.push({ teamId: loserId, placement: "2nd" });
    }

    return result;
  },
};

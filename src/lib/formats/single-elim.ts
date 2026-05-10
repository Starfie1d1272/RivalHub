import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { matches, seasons, teams } from "@/db/schema";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { generateBracket, seedPlayoff, type BracketStageRef, type BracketParticipantRef } from "@/lib/bracket";
import { getPreviousStage, normalizeStagePlan } from "@/types/season";
import type { StageExecutor } from "./types";
import type { Database } from "brackets-manager";
import type { QualifiedTeam } from "@/types/season";
import type { Team } from "@/db/schema/teams";
import { isStageComplete } from "./_shared";

// ── entry_round 映射 ──────────────────────────────────────────────────────────

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
  // round 1 → earliest entry round, round N → final
  const idx = Math.max(0, ENTRY_ROUNDS.length - totalRounds + roundNumber - 1);
  return ENTRY_ROUNDS[idx] ?? null;
}

// ── seeding 构建 ──────────────────────────────────────────────────────────────

/**
 * 从 qualifiers 构建 bracket seeding 数组。
 * 按 placement 分组 → 组间交叉排列（2nd-A, 3rd-B, 2nd-B, 3rd-A），
 * 1st 放在末尾以利用 brackets-manager 的 bye 填充。
 */
function buildSeedingFromQualifiers(
  qualifiers: QualifiedTeam[],
  teams: Team[],
): string[] {
  const teamMap = new Map(teams.map((t) => [t.id, t]));

  // 按 placement 分组
  const byPlacement = new Map<string, QualifiedTeam[]>();
  for (const q of qualifiers) {
    const list = byPlacement.get(q.placement) ?? [];
    list.push(q);
    byPlacement.set(q.placement, list);
  }

  // 按 placement 优先级排序（非 "1st" 的在前，1st 在末尾享受 bye）
  const placements = [...byPlacement.keys()].sort((a, b) => {
    if (a === "1st") return 1;
    if (b === "1st") return -1;
    return a.localeCompare(b);
  });

  const seeding: string[] = [];
  for (const placement of placements) {
    const entries = byPlacement.get(placement)!;
    // 组内交叉：group A, B → 交错排列
    const sorted = [...entries].sort((a, b) => (a.group ?? "").localeCompare(b.group ?? ""));
    for (const entry of sorted) {
      const team = teamMap.get(entry.teamId);
      if (team) seeding.push(team.name);
    }
  }

  return seeding;
}

// ── executor ──────────────────────────────────────────────────────────────────

export const singleElimExecutor: StageExecutor = {
  async initialize(seasonId, config, teams, qualifiers) {
    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, seasonId),
    });
    if (!season) {
      throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
    }

    const stagePlan = normalizeStagePlan(season.stagePlan);
    const previousStage = getPreviousStage(stagePlan, config.key);

    // 计算 bracket 总轮数 → 用于 entry_round 映射
    const bracketSize = nextPowerOfTwo(config.teamCount);

    if (!previousStage) {
      // 首阶段：完整 bracket 生成
      const { data, resolvedMatches } = await generateBracket(teams, {
        qualifierFormat: null,
        playoffFormat: "single_elim",
        playoffName: config.name,
      });

      const bracketStages = data.stage as BracketStageRef[];
      const stageId = bracketStages.find((s) => s.name === config.name)?.id ?? null;
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
          format: config.matchFormat ?? "bo3",
          status: "scheduled",
          bracketNodeId: bm.bracketMatchId.toString(),
          entryRound: mapRoundToEntryRound(bm.roundNumber, bracketSize),
        });
        matchCount++;
      }

      await db
        .update(seasons)
        .set({ bracketData: data as Database, updatedAt: new Date() })
        .where(eq(seasons.id, seasonId));

      return { matchCount };
    }

    // 非首阶段：从 qualifiers 构建 seeding → seedPlayoff
    if (!season.bracketData) {
      throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "请先一键生成赛程");
    }

    if (!qualifiers || qualifiers.length === 0) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `${previousStage.name} 没有晋级队伍，无法初始化 ${config.name}`,
      );
    }

    const seeding = buildSeedingFromQualifiers(qualifiers, teams);

    const { updatedData, resolvedMatches } = await seedPlayoff(
      seeding,
      season.bracketData as Database,
      config.name,
    );

    const nameToTeam = new Map(teams.map((t) => [t.name, t]));
    const participants = updatedData.participant as BracketParticipantRef[];
    const participantIdToTeam = new Map(
      participants.map((p) => [p.id, nameToTeam.get(p.name)]),
    );
    const bracketStages = updatedData.stage as BracketStageRef[];
    const stageId = bracketStages.find((s) => s.name === config.name)?.id ?? null;
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
        format: config.matchFormat ?? "bo3",
        status: "scheduled",
        bracketNodeId: bm.bracketMatchId.toString(),
        entryRound: mapRoundToEntryRound(bm.roundNumber, bracketSize),
      });
      matchCount++;
    }

    await db
      .update(seasons)
      .set({ bracketData: updatedData as Database, updatedAt: new Date() })
      .where(eq(seasons.id, seasonId));

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
      orderBy: (matches, { desc }) => [desc(matches.round)],
    });

    if (stageMatches.length === 0) return [];

    const finalMatch = stageMatches[0];
    if (finalMatch.scoreA === null || finalMatch.scoreB === null) return [];
    if (finalMatch.scoreA === finalMatch.scoreB) return [];

    const winnerId = finalMatch.scoreA > finalMatch.scoreB ? finalMatch.teamAId : finalMatch.teamBId;
    const loserId = finalMatch.scoreA > finalMatch.scoreB ? finalMatch.teamBId : finalMatch.teamAId;

    const result: QualifiedTeam[] = [{ teamId: winnerId, placement: "1st" }];

    // 如果配置要求亚军晋级
    const hasSecondPlace = config.advanceTiers.some((t) => t.placement === "2nd");
    if (hasSecondPlace) {
      result.push({ teamId: loserId, placement: "2nd" });
    }

    return result;
  },
};

/** 返回 ≥ n 的最小 2 的幂 */
function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { matches } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import type { StageExecutor } from "./types";
import type { Team } from "@/db/schema/teams";
import type { QualifiedTeam } from "@/types/season";

// ── 蛇形分组 ─────────────────────────────────────────────────────────────────

function groupLabel(index: number): string {
  return String.fromCharCode(65 + index); // A, B, C, ...
}

/** snake(0)=A, snake(1)=B, snake(2)=B, snake(3)=A, … */
function snakeGroup(seedIndex: number, groupCount: number): number {
  const cycle = groupCount * 2;
  const pos = seedIndex % cycle;
  return pos < groupCount ? pos : cycle - 1 - pos;
}

// ── 对阵生成 ─────────────────────────────────────────────────────────────────

function genR1Pairs(teamIds: string[], teamsPerGroup: number): [string, string][] {
  if (teamsPerGroup === 4) {
    return [
      [teamIds[0], teamIds[3]],
      [teamIds[1], teamIds[2]],
    ];
  }
  // 8 队
  return [
    [teamIds[0], teamIds[7]],
    [teamIds[3], teamIds[4]],
    [teamIds[1], teamIds[6]],
    [teamIds[2], teamIds[5]],
  ];
}

// ── 分组推导（从比赛连通分量）─────────────────────────────────────────────────

/**
 * 从 R1 比赛推导分组。
 * initialize 按组顺序插入 match，因此 R1 比赛按 createdAt 排序后，
 * 每 matchesPerGroup 场比赛属于同一个组。
 */
async function deriveGroups(
  seasonId: string,
  stageKey: string,
): Promise<Map<string, string[]>> {
  const r1Matches = await db.query.matches.findMany({
    where: and(eq(matches.seasonId, seasonId), eq(matches.stage, stageKey), eq(matches.round, 1)),
  });

  // 4 队/组 → 2 场 R1；8 队/组 → 4 场 R1
  const matchesPerGroup = r1Matches.length >= 8 ? 4 : 2;
  const groupCount = r1Matches.length / matchesPerGroup;

  // 按 createdAt 排序确保稳定批次
  const sorted = [...r1Matches].sort(sortByCreated);

  const result = new Map<string, string[]>();
  for (let g = 0; g < groupCount; g++) {
    const teamSet = new Set<string>();
    for (let i = g * matchesPerGroup; i < (g + 1) * matchesPerGroup && i < sorted.length; i++) {
      teamSet.add(sorted[i].teamAId);
      teamSet.add(sorted[i].teamBId);
    }
    result.set(groupLabel(g), [...teamSet]);
  }

  return result;
}

// ── 战绩计算 ─────────────────────────────────────────────────────────────────

async function computeRecords(
  seasonId: string,
  stageKey: string,
  groups: Map<string, string[]>,
): Promise<{ teamId: string; wins: number; losses: number; group: string }[]> {
  const allTeamIds = [...groups.values()].flat();
  if (allTeamIds.length === 0) return [];

  const teamGroup = new Map<string, string>();
  for (const [g, ids] of groups) {
    for (const id of ids) teamGroup.set(id, g);
  }

  const record = new Map<string, { wins: number; losses: number }>();
  for (const id of allTeamIds) record.set(id, { wins: 0, losses: 0 });

  const allMatches = await db.query.matches.findMany({
    where: and(
      eq(matches.seasonId, seasonId),
      eq(matches.stage, stageKey),
      eq(matches.status, "finished"),
    ),
  });

  for (const m of allMatches) {
    if (m.scoreA === null || m.scoreB === null) continue;
    const a = record.get(m.teamAId);
    const b = record.get(m.teamBId);
    if (!a || !b) continue;
    if (m.scoreA > m.scoreB) { a.wins++; b.losses++; }
    else { b.wins++; a.losses++; }
  }

  return allTeamIds.map((teamId) => ({
    teamId,
    wins: record.get(teamId)!.wins,
    losses: record.get(teamId)!.losses,
    group: teamGroup.get(teamId)!,
  }));
}

// ── winner / loser 提取 ──────────────────────────────────────────────────────

function getWinner(m: { teamAId: string; teamBId: string; scoreA: number | null; scoreB: number | null }): string | null {
  if (m.scoreA === null || m.scoreB === null || m.scoreA === m.scoreB) return null;
  return m.scoreA > m.scoreB ? m.teamAId : m.teamBId;
}

function getLoser(m: { teamAId: string; teamBId: string; scoreA: number | null; scoreB: number | null }): string | null {
  if (m.scoreA === null || m.scoreB === null || m.scoreA === m.scoreB) return null;
  return m.scoreA > m.scoreB ? m.teamBId : m.teamAId;
}

// ── executor ─────────────────────────────────────────────────────────────────

export const gslGroupExecutor: StageExecutor = {
  async initialize(seasonId, config, teams, _qualifiers) {
    const groupCount = config.groupCount ?? 1;
    const teamsPerGroup = Math.floor(teams.length / groupCount);

    if (teamsPerGroup !== 4 && teamsPerGroup !== 8) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `GSL 组仅支持 4 或 8 队/组，当前 ${teamsPerGroup} 队/组`,
      );
    }

    // 蛇形分配
    const groups = new Map<string, Team[]>();
    for (let i = 0; i < groupCount; i++) groups.set(groupLabel(i), []);

    for (let i = 0; i < teams.length; i++) {
      const g = snakeGroup(i, groupCount);
      groups.get(groupLabel(g))!.push(teams[i]);
    }

    let matchCount = 0;

    for (const [, groupTeams] of groups) {
      const ids = groupTeams.map((t) => t.id);
      const pairs = genR1Pairs(ids, teamsPerGroup);

      for (const [teamAId, teamBId] of pairs) {
        await db.insert(matches).values({
          seasonId,
          teamAId,
          teamBId,
          stage: config.key,
          round: 1,
          format: config.matchFormat ?? "bo3",
          status: "scheduled",
        });
        matchCount++;
      }
    }

    return { matchCount };
  },

  async advanceRound(seasonId, stageKey) {
    const allMatches = await db.query.matches.findMany({
      where: and(eq(matches.seasonId, seasonId), eq(matches.stage, stageKey)),
    });

    if (allMatches.length === 0) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "该阶段无比赛，请先初始化");
    }

    const currentRound = Math.max(...allMatches.map((m) => m.round ?? 0));
    if (currentRound >= 4) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "GSL 最多 4 轮");
    }

    // 当前轮是否全部完成
    const roundMatches = allMatches.filter((m) => m.round === currentRound);
    const unfinished = roundMatches.filter((m) => m.status !== "finished");
    if (unfinished.length > 0) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `第 ${currentRound} 轮还有 ${unfinished.length} 场比赛未完成`,
      );
    }

    const groups = await deriveGroups(seasonId, stageKey);
    const nextRound = currentRound + 1;
    let matchCount = 0;

    for (const [, groupTeamIds] of groups) {
      // 仅取当前组的比赛
      const gMatches = allMatches.filter(
        (m) => groupTeamIds.includes(m.teamAId) || groupTeamIds.includes(m.teamBId),
      );

      if (nextRound === 2) {
        // R2: R1 相邻 match 的胜者对阵（8 队组分上下半区；4 队组只有 1 场）
        const r1 = gMatches.filter((m) => m.round === 1).sort(sortByCreated);
        for (let i = 0; i < r1.length; i += 2) {
          matchCount += await createPair(seasonId, stageKey, 2, [r1[i], r1[i + 1]], "winners");
        }
      } else if (nextRound === 3) {
        // R3: R1 相邻 match 的败者对阵
        const r1 = gMatches.filter((m) => m.round === 1).sort(sortByCreated);
        for (let i = 0; i < r1.length; i += 2) {
          matchCount += await createPair(seasonId, stageKey, 3, [r1[i], r1[i + 1]], "losers");
        }
      } else {
        // R4: R2 败者 vs R3 胜者（同半区）
        const r2 = gMatches.filter((m) => m.round === 2).sort(sortByCreated);
        const r3 = gMatches.filter((m) => m.round === 3).sort(sortByCreated);

        for (let i = 0; i < r2.length; i++) {
          const r2Loser = getLoser(r2[i]);
          const r3Winner = getWinner(r3[i]);
          if (!r2Loser || !r3Winner) continue;

          await db.insert(matches).values({
            seasonId,
            teamAId: r2Loser,
            teamBId: r3Winner,
            stage: stageKey,
            round: 4,
            format: "bo3",
            status: "scheduled",
          });
          matchCount++;
        }
      }
    }

    return { matchCount };
  },

  async getQualifiers(seasonId, config) {
    const groups = await deriveGroups(seasonId, config.key);
    if (groups.size === 0) return [];

    const records = await computeRecords(seasonId, config.key, groups);

    const result: QualifiedTeam[] = [];
    for (const [, groupTeamIds] of groups) {
      const groupRecords = records
        .filter((r) => groupTeamIds.includes(r.teamId))
        .sort((a, b) => b.wins - a.wins || a.losses - b.losses);

      for (const rec of groupRecords) {
        let placement: string;
        if (rec.wins === 2 && rec.losses === 0) placement = "1st";
        else if (rec.wins === 2 && rec.losses === 1) placement = "2nd";
        else if (rec.wins === 1 && rec.losses === 2) placement = "3rd";
        else placement = `${rec.wins}w-${rec.losses}l`;

        result.push({ teamId: rec.teamId, placement, group: rec.group });
      }
    }

    return result;
  },

  async isComplete(seasonId, stageKey) {
    const allMatches = await db.query.matches.findMany({
      where: and(eq(matches.seasonId, seasonId), eq(matches.stage, stageKey)),
    });
    if (allMatches.length === 0) return false;
    return allMatches.every((m) => m.status === "finished" || m.status === "cancelled");
  },
};

// ── 内部工具 ──────────────────────────────────────────────────────────────────

const sortByCreated = (a: { createdAt?: Date | null }, b: { createdAt?: Date | null }) =>
  (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);

async function createPair(
  seasonId: string, stageKey: string, round: number,
  pool: ({ teamAId: string; teamBId: string; scoreA: number | null; scoreB: number | null } | undefined)[],
  pick: "winners" | "losers",
): Promise<number> {
  const extract = pick === "winners" ? getWinner : getLoser;
  const a = pool[0] ? extract(pool[0]) : null;
  const b = pool[1] ? extract(pool[1]) : null;
  if (!a || !b) return 0;

  await db.insert(matches).values({
    seasonId, teamAId: a, teamBId: b, stage: stageKey, round, format: "bo3", status: "scheduled",
  });
  return 1;
}

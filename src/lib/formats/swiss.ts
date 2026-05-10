import { and, eq, asc, sql, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { matches, swissStandings } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import type { StageExecutor } from "./types";
import type { StageConfig, QualifiedTeam } from "@/types/season";
import type { Team } from "@/db/schema/teams";

// ── 常量 ───────────────────────────────────────────────

const WIN_THRESHOLD = 3;
const LOSS_THRESHOLD = 3;

interface SwissRow {
  id: string;
  seasonId: string;
  stage: string;
  teamId: string;
  seed: number;
  wins: number;
  losses: number;
  buScore: number;
  status: string;
}

interface MatchPair {
  teamAId: string;
  teamBId: string;
  format: "bo1" | "bo3";
}

// ── Executor ───────────────────────────────────────────

export const swissExecutor: StageExecutor = {
  async initialize(seasonId, config, teams, _qualifiers) {
    if (!config.seeds || config.seeds.length !== teams.length) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `瑞士轮需要 ${teams.length} 个种子，当前种子数为 ${config.seeds?.length ?? 0}`,
      );
    }

    // 按种子排序队伍
    const teamWithSeed = teams
      .map((t, i) => ({ team: t, seed: config.seeds![i] }))
      .sort((a, b) => a.seed - b.seed);
    const sorted = teamWithSeed.map((ts) => ts.team);

    // 写入 standings
    await db.insert(swissStandings).values(
      teamWithSeed.map((ts) => ({
        seasonId,
        stage: config.key,
        teamId: ts.team.id,
        seed: ts.seed,
        wins: 0,
        losses: 0,
        buScore: 0,
        status: "active",
      })),
    );

    // R1: 上半区 vs 下半区
    const half = sorted.length / 2;
    const pairs: MatchPair[] = [];
    for (let i = 0; i < half; i++) {
      pairs.push({ teamAId: sorted[i].id, teamBId: sorted[i + half].id, format: "bo1" });
    }

    if (pairs.length > 0) {
      await db.insert(matches).values(
        pairs.map((p) => ({
          seasonId,
          teamAId: p.teamAId,
          teamBId: p.teamBId,
          stage: config.key,
          round: 1,
          format: p.format,
          status: "scheduled" as const,
        })),
      );
    }

    return { matchCount: pairs.length };
  },

  async advanceRound(seasonId, stageKey) {
    return db.transaction(async (tx) => {
      // 1. 一次读取全部 stage matches（含历史轮次），在内存中求当前轮
      const allStageMatches = await tx.query.matches.findMany({
        where: and(eq(matches.seasonId, seasonId), eq(matches.stage, stageKey)),
      });
      if (allStageMatches.length === 0) {
        throw new AppError(ErrorCode.DRAFT_NOT_ACTIVE, "瑞士轮尚未初始化");
      }
      const currentRound = Math.max(...allStageMatches.map((m) => m.round ?? 0));
      const roundMatches = allStageMatches.filter((m) => (m.round ?? 0) === currentRound);

      // 2. 检查当前轮是否全部结束
      const unfinished = roundMatches.filter(
        (m) => m.status !== "finished" && m.status !== "cancelled",
      );
      if (unfinished.length > 0) {
        throw new AppError(
          ErrorCode.SEASON_INVALID_STATUS,
          `第 ${currentRound} 轮还有 ${unfinished.length} 场比赛未结束`,
        );
      }

      // 3. 读 standings（只读一次），维护可变内存副本
      const standingRows = (await tx.query.swissStandings.findMany({
        where: and(
          eq(swissStandings.seasonId, seasonId),
          eq(swissStandings.stage, stageKey),
        ),
        orderBy: [asc(swissStandings.seed)],
      })) as SwissRow[];
      const standingMap = new Map(standingRows.map((s) => [s.teamId, { ...s }]));

      // 4. 更新 wins/losses（DB 原子写 + 内存同步）
      for (const m of roundMatches) {
        if (m.status === "cancelled") continue;
        if (m.scoreA === null || m.scoreB === null) {
          throw new AppError(
            ErrorCode.VALIDATION_FAILED,
            `第 ${currentRound} 轮比赛 ${m.id} 比分未录入`,
          );
        }
        if (m.scoreA === m.scoreB) {
          throw new AppError(
            ErrorCode.VALIDATION_FAILED,
            `第 ${currentRound} 轮比赛 ${m.id} 出现平局，瑞士轮不允许平局`,
          );
        }
        const winA = m.scoreA > m.scoreB;
        const winnerId = winA ? m.teamAId : m.teamBId;
        const loserId = winA ? m.teamBId : m.teamAId;
        standingMap.get(winnerId)!.wins++;
        standingMap.get(loserId)!.losses++;
        await tx
          .update(swissStandings)
          .set({ wins: sql`wins + 1` })
          .where(
            and(
              eq(swissStandings.seasonId, seasonId),
              eq(swissStandings.stage, stageKey),
              eq(swissStandings.teamId, winnerId),
            ),
          );
        await tx
          .update(swissStandings)
          .set({ losses: sql`losses + 1` })
          .where(
            and(
              eq(swissStandings.seasonId, seasonId),
              eq(swissStandings.stage, stageKey),
              eq(swissStandings.teamId, loserId),
            ),
          );
      }

      // 5. 标记 advanced / eliminated（内存决策，批量写 DB）
      const advancedIds: string[] = [];
      const eliminatedIds: string[] = [];
      for (const s of standingMap.values()) {
        if (s.status !== "active") continue;
        if (s.wins >= WIN_THRESHOLD) {
          s.status = "advanced";
          advancedIds.push(s.id);
        } else if (s.losses >= LOSS_THRESHOLD) {
          s.status = "eliminated";
          eliminatedIds.push(s.id);
        }
      }
      if (advancedIds.length > 0) {
        await tx
          .update(swissStandings)
          .set({ status: "advanced" })
          .where(inArray(swissStandings.id, advancedIds));
      }
      if (eliminatedIds.length > 0) {
        await tx
          .update(swissStandings)
          .set({ status: "eliminated" })
          .where(inArray(swissStandings.id, eliminatedIds));
      }

      // 6. BU 计算（内存 standingMap + allStageMatches，无需重读 standings 或 matches）
      const finishedMatches = allStageMatches.filter((m) => m.status === "finished");
      const teamDiff = new Map<string, number>(
        [...standingMap.values()].map((s) => [s.teamId, s.wins - s.losses]),
      );
      for (const s of standingMap.values()) {
        if (s.status !== "active") continue;
        let bu = 0;
        for (const m of finishedMatches) {
          if (m.teamAId === s.teamId) bu += teamDiff.get(m.teamBId) ?? 0;
          else if (m.teamBId === s.teamId) bu += teamDiff.get(m.teamAId) ?? 0;
        }
        await tx
          .update(swissStandings)
          .set({ buScore: bu })
          .where(eq(swissStandings.id, s.id));
      }

      // 7. 配对（从内存 Map 过滤 active，无需重读 standings）
      const activeRows = [...standingMap.values()]
        .filter((s) => s.status === "active")
        .sort((a, b) => a.seed - b.seed);
      if (activeRows.length === 0) return { matchCount: 0 };

      const opponents = buildOpponents(allStageMatches);
      const nextRound = currentRound + 1;
      const pairs = pairSwissRound(activeRows, nextRound, opponents);

      // 8. 批量插入新 matches
      if (pairs.length > 0) {
        await tx.insert(matches).values(
          pairs.map((p) => ({
            seasonId,
            teamAId: p.teamAId,
            teamBId: p.teamBId,
            stage: stageKey,
            round: nextRound,
            format: (isWinAndIn(p, activeRows) || isLossAndOut(p, activeRows))
              ? ("bo3" as const)
              : ("bo1" as const),
            status: "scheduled" as const,
          })),
        );
      }

      return { matchCount: pairs.length };
    });
  },

  async isComplete(seasonId, stageKey) {
    const standings = await db.query.swissStandings.findMany({
      where: and(
        eq(swissStandings.seasonId, seasonId),
        eq(swissStandings.stage, stageKey),
      ),
    });
    if (standings.length === 0) return false;
    return standings.every((s) => s.status !== "active");
  },

  async getQualifiers(seasonId, config) {
    const rows = await db.query.swissStandings.findMany({
      where: and(
        eq(swissStandings.seasonId, seasonId),
        eq(swissStandings.stage, config.key),
        eq(swissStandings.status, "advanced"),
      ),
      orderBy: [asc(swissStandings.seed)],
    });
    return rows.map((r) => ({
      teamId: r.teamId,
      placement: "*",
    }));
  },
};

// ── 配对算法 ───────────────────────────────────────────

function buildOpponents(
  allMatches: { teamAId: string; teamBId: string; status: string }[],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const finished = allMatches.filter((m) => m.status === "finished");
  for (const m of finished) {
    addOpponent(map, m.teamAId, m.teamBId);
    addOpponent(map, m.teamBId, m.teamAId);
  }
  return map;
}

function addOpponent(map: Map<string, Set<string>>, teamId: string, opponentId: string) {
  let set = map.get(teamId);
  if (!set) {
    set = new Set<string>();
    map.set(teamId, set);
  }
  set.add(opponentId);
}

function pairSwissRound(
  active: SwissRow[],
  round: number,
  opponents: Map<string, Set<string>>,
): MatchPair[] {
  // 按 wins 分组
  const groups = new Map<number, SwissRow[]>();
  for (const t of active) {
    const list = groups.get(t.wins) ?? [];
    list.push(t);
    groups.set(t.wins, list);
  }

  // 每组内排序
  for (const [, group] of groups) {
    group.sort((a, b) => {
      if (round === 2) {
        return a.seed - b.seed; // R2: seed 升序
      }
      // R3+: BU 降序，tiebreak seed 升序
      if (b.buScore !== a.buScore) return b.buScore - a.buScore;
      return a.seed - b.seed;
    });
  }

  const sortedWins = Array.from(groups.keys()).sort((a, b) => b - a);
  const paired = new Set<string>();
  const result: MatchPair[] = [];

  for (const wins of sortedWins) {
    const group = groups.get(wins)!;
    const available = group.filter((t) => !paired.has(t.teamId));
    const groupPairs = slidePair(available, opponents);
    for (const p of groupPairs) {
      paired.add(p.teamAId);
      paired.add(p.teamBId);
      result.push(p);
    }
  }

  // 处理未配对的：向下配对
  const unpaired = active.filter((t) => !paired.has(t.teamId));
  for (const u of unpaired) {
    for (const lowerWins of sortedWins) {
      if (lowerWins >= (u.wins ?? 0)) continue;
      const lowerGroup = groups.get(lowerWins)!;
      const candidate = lowerGroup.find(
        (t) =>
          !paired.has(t.teamId) &&
          !(opponents.get(u.teamId)?.has(t.teamId) ?? false),
      );
      if (candidate) {
        paired.add(u.teamId);
        paired.add(candidate.teamId);
        result.push({ teamAId: u.teamId, teamBId: candidate.teamId, format: "bo1" });
        break;
      }
    }
  }

  return result;
}

function slidePair(
  available: SwissRow[],
  opponents: Map<string, Set<string>>,
): MatchPair[] {
  const result: MatchPair[] = [];
  const used = new Set<string>();

  while (available.filter((t) => !used.has(t.teamId)).length >= 2) {
    const remaining = available.filter((t) => !used.has(t.teamId));
    const top = remaining[0];
    const bottom = remaining[remaining.length - 1];

    if (!(opponents.get(top.teamId)?.has(bottom.teamId) ?? false)) {
      used.add(top.teamId);
      used.add(bottom.teamId);
      result.push({ teamAId: top.teamId, teamBId: bottom.teamId, format: "bo1" });
    } else {
      // 尝试与倒数第二个配对
      let found = false;
      for (let i = remaining.length - 2; i >= 1; i--) {
        if (!(opponents.get(top.teamId)?.has(remaining[i].teamId) ?? false)) {
          used.add(top.teamId);
          used.add(remaining[i].teamId);
          result.push({ teamAId: top.teamId, teamBId: remaining[i].teamId, format: "bo1" });
          found = true;
          break;
        }
      }
      if (!found) {
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          `无法为 ${top.teamId} 配对：所有同战绩候选均已交手`,
        );
      }
    }
  }

  return result;
}

function isWinAndIn(p: MatchPair, standings: SwissRow[]): boolean {
  const tA = standings.find((s) => s.teamId === p.teamAId);
  const tB = standings.find((s) => s.teamId === p.teamBId);
  return (tA?.wins === WIN_THRESHOLD - 1) || (tB?.wins === WIN_THRESHOLD - 1);
}

function isLossAndOut(p: MatchPair, standings: SwissRow[]): boolean {
  const tA = standings.find((s) => s.teamId === p.teamAId);
  const tB = standings.find((s) => s.teamId === p.teamBId);
  return (tA?.losses === LOSS_THRESHOLD - 1) || (tB?.losses === LOSS_THRESHOLD - 1);
}

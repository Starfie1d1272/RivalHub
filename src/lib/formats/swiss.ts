import { and, eq, asc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { matches, swissStandings, teams as teamsTable } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import type { StageExecutor } from "./types";
import type { StageConfig } from "@/types/season";
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
  async initialize(seasonId, config, teams) {
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

    for (const p of pairs) {
      await db.insert(matches).values({
        seasonId,
        teamAId: p.teamAId,
        teamBId: p.teamBId,
        stage: config.key,
        round: 1,
        format: p.format,
        status: "scheduled",
      });
    }

    return { matchCount: pairs.length };
  },

  async advanceRound(seasonId, stageKey) {
    return db.transaction(async (tx) => {
      // 1. 查当前轮次
      const matchRows = await tx
        .select({ round: matches.round })
        .from(matches)
        .where(and(eq(matches.seasonId, seasonId), eq(matches.stage, stageKey)));
      if (matchRows.length === 0) {
        throw new AppError(ErrorCode.DRAFT_NOT_ACTIVE, "瑞士轮尚未初始化");
      }
      const currentRound = Math.max(...matchRows.map((r) => r.round ?? 0));

      // 2. 检查当前轮是否全部结束
      const roundMatches = await tx.query.matches.findMany({
        where: and(
          eq(matches.seasonId, seasonId),
          eq(matches.stage, stageKey),
          eq(matches.round, currentRound),
        ),
      });
      const unfinished = roundMatches.filter(
        (m) => m.status !== "finished" && m.status !== "cancelled",
      );
      if (unfinished.length > 0) {
        throw new AppError(
          ErrorCode.SEASON_INVALID_STATUS,
          `第 ${currentRound} 轮还有 ${unfinished.length} 场比赛未结束`,
        );
      }

      // 3. 读 standings
      const standings = await tx.query.swissStandings.findMany({
        where: and(
          eq(swissStandings.seasonId, seasonId),
          eq(swissStandings.stage, stageKey),
        ),
        orderBy: [asc(swissStandings.seed)],
      });
      const standingMap = new Map(standings.map((s) => [s.teamId, s]));

      // 4. 更新 wins/losses
      for (const m of roundMatches) {
        if (m.status === "cancelled") continue;
        const winA = (m.scoreA ?? 0) > (m.scoreB ?? 0);
        if (winA) {
          await tx
            .update(swissStandings)
            .set({ wins: sql`wins + 1` })
            .where(
              and(
                eq(swissStandings.seasonId, seasonId),
                eq(swissStandings.stage, stageKey),
                eq(swissStandings.teamId, m.teamAId),
              ),
            );
          await tx
            .update(swissStandings)
            .set({ losses: sql`losses + 1` })
            .where(
              and(
                eq(swissStandings.seasonId, seasonId),
                eq(swissStandings.stage, stageKey),
                eq(swissStandings.teamId, m.teamBId),
              ),
            );
        } else {
          await tx
            .update(swissStandings)
            .set({ wins: sql`wins + 1` })
            .where(
              and(
                eq(swissStandings.seasonId, seasonId),
                eq(swissStandings.stage, stageKey),
                eq(swissStandings.teamId, m.teamBId),
              ),
            );
          await tx
            .update(swissStandings)
            .set({ losses: sql`losses + 1` })
            .where(
              and(
                eq(swissStandings.seasonId, seasonId),
                eq(swissStandings.stage, stageKey),
                eq(swissStandings.teamId, m.teamAId),
              ),
            );
        }
      }

      // 5. 重读 standings
      const updated = await tx.query.swissStandings.findMany({
        where: and(
          eq(swissStandings.seasonId, seasonId),
          eq(swissStandings.stage, stageKey),
        ),
      }) as SwissRow[];

      // 6. 标记 advanced / eliminated
      for (const s of updated) {
        if (s.status !== "active") continue;
        if (s.wins >= WIN_THRESHOLD) {
          await tx
            .update(swissStandings)
            .set({ status: "advanced" })
            .where(eq(swissStandings.id, s.id));
        } else if (s.losses >= LOSS_THRESHOLD) {
          await tx
            .update(swissStandings)
            .set({ status: "eliminated" })
            .where(eq(swissStandings.id, s.id));
        }
      }

      // 7. BU 计算：对每个 active 队伍，汇总所有对手的 (wins - losses)
      const finalStandings = await tx.query.swissStandings.findMany({
        where: and(
          eq(swissStandings.seasonId, seasonId),
          eq(swissStandings.stage, stageKey),
        ),
      }) as SwissRow[];
      const teamDiff = new Map<string, number>(
        finalStandings.map((s) => [s.teamId, s.wins - s.losses]),
      );

      const allMatches = await tx.query.matches.findMany({
        where: and(
          eq(matches.seasonId, seasonId),
          eq(matches.stage, stageKey),
          eq(matches.status, "finished"),
        ),
      });

      for (const s of finalStandings) {
        if (s.status !== "active") continue;
        let bu = 0;
        for (const m of allMatches) {
          if (m.teamAId === s.teamId) {
            bu += teamDiff.get(m.teamBId) ?? 0;
          } else if (m.teamBId === s.teamId) {
            bu += teamDiff.get(m.teamAId) ?? 0;
          }
        }
        await tx
          .update(swissStandings)
          .set({ buScore: bu })
          .where(eq(swissStandings.id, s.id));
      }

      // 8. 配对
      const activeRows = (await tx.query.swissStandings.findMany({
        where: and(
          eq(swissStandings.seasonId, seasonId),
          eq(swissStandings.stage, stageKey),
          eq(swissStandings.status, "active"),
        ),
        orderBy: [asc(swissStandings.seed)],
      })) as SwissRow[];
      if (activeRows.length === 0) return { matchCount: 0 };

      // 构建已交手记录
      const opponents = buildOpponents(allMatches);

      const nextRound = currentRound + 1;
      const pairs = pairSwissRound(activeRows, nextRound, opponents);

      // 9. 插入新 matches
      for (const p of pairs) {
        const isDecisive =
          isWinAndIn(p, activeRows) || isLossAndOut(p, activeRows);
        const format = isDecisive ? "bo3" : "bo1";

        await tx.insert(matches).values({
          seasonId,
          teamAId: p.teamAId,
          teamBId: p.teamBId,
          stage: stageKey,
          round: nextRound,
          format,
          status: "scheduled",
        });
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
        // 退而求其次：与第二个配对
        used.add(top.teamId);
        used.add(remaining[1].teamId);
        result.push({ teamAId: top.teamId, teamBId: remaining[1].teamId, format: "bo1" });
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

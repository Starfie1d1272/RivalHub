// 排位赛积分榜计算
//
// 排名规则（优先级从高到低）：
//   1. 胜场数（wins）
//   2. 净胜回合数（netRounds = Σ(己方rounds - 对方rounds)）
//   3. 总胜回合数（totalRoundsWon）
//   4. 相互战绩（head-to-head胜负）
//   5. 抽签（原始 draftOrder）
//
// BO1 场景下：matches.scoreA/scoreB 存储的是回合数（如 13、8），
// 胜者 = 回合数更高的一方（不允许平局）。

import type { Team } from "@/db/schema/teams";
import type { Match } from "@/db/schema/matches";

export interface TeamStanding {
  teamId: string;
  teamName: string;
  draftOrder: number;
  /** 胜场 */
  wins: number;
  /** 负场 */
  losses: number;
  /** Σ(己方rounds - 对方rounds) */
  netRounds: number;
  /** Σ己方rounds */
  totalRoundsWon: number;
  /** 排名（1-based） */
  seed: number;
}

/**
 * 计算积分榜，返回按种子排序的结果。
 * 这是一个纯函数，不访问数据库。调用方负责传入已完成比赛。
 */
export function calculateStandings(
  teams: Team[],
  finishedMatches: Match[],
): TeamStanding[] {
  // 初始化每支队伍的数据
  const stats = new Map<string, { wins: number; losses: number; netRounds: number; totalRoundsWon: number }>();
  for (const t of teams) {
    stats.set(t.id, { wins: 0, losses: 0, netRounds: 0, totalRoundsWon: 0 });
  }

  for (const m of finishedMatches) {
    const a = stats.get(m.teamAId);
    const b = stats.get(m.teamBId);
    if (!a || !b || m.scoreA === null || m.scoreB === null) continue;

    const scoreA = m.scoreA;
    const scoreB = m.scoreB;

    a.totalRoundsWon += scoreA;
    b.totalRoundsWon += scoreB;
    a.netRounds += scoreA - scoreB;
    b.netRounds += scoreB - scoreA;
    if (scoreA > scoreB) { a.wins++; b.losses++; }
    else { b.wins++; a.losses++; }
  }

  const standings: TeamStanding[] = teams.map((t) => {
    const s = stats.get(t.id)!;
    return { teamId: t.id, teamName: t.name, draftOrder: t.draftOrder, ...s, seed: 0 };
  });

  // 排序：胜场 → 净胜 → 总胜回合 → 相互战绩 → draftOrder（稳定）
  standings.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.netRounds !== a.netRounds) return b.netRounds - a.netRounds;
    if (b.totalRoundsWon !== a.totalRoundsWon) return b.totalRoundsWon - a.totalRoundsWon;

    // 相互战绩：查 finishedMatches 中两队之间的比赛
    const h2h = finishedMatches.find(
      (m) =>
        (m.teamAId === a.teamId && m.teamBId === b.teamId) ||
        (m.teamAId === b.teamId && m.teamBId === a.teamId),
    );
    if (h2h) {
      const aWonH2H =
        (h2h.teamAId === a.teamId && (h2h.scoreA ?? 0) > (h2h.scoreB ?? 0)) ||
        (h2h.teamBId === a.teamId && (h2h.scoreB ?? 0) > (h2h.scoreA ?? 0));
      if (aWonH2H) return -1;
      return 1;
    }

    // 最终 fallback：draftOrder（选秀顺位）
    return a.draftOrder - b.draftOrder;
  });

  standings.forEach((s, i) => { s.seed = i + 1; });
  return standings;
}

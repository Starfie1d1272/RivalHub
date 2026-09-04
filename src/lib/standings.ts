// 排位赛积分榜计算
//
// 排名规则（优先级从高到低）：
//   1. 胜场数（wins）
//   2. 净胜回合数（netRounds = Σ(己方rounds - 对方rounds)）
//   3. 总胜回合数（totalRoundsWon）
//   4. 相互战绩（head-to-head胜负）
//   5. 抽签（原始 draftOrder）
//
// matches.scoreA/scoreB 始终是系列赛比分；排名中的回合项只消费
// match_maps 中实际完成地图的回合事实。弃赛没有实际地图，因此不贡献回合数。

import type { CompetitionEntry } from "@/db/schema/competition-entries";
import type { Match } from "@/db/schema/matches";

export interface MatchRoundScore {
  scoreA: number;
  scoreB: number;
}

export interface TeamStanding {
  teamId: string;
  teamName: string;
  draftOrder: number | null;
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
  competitionEntries: CompetitionEntry[],
  finishedMatches: Match[],
  roundScoresByMatchId: ReadonlyMap<string, readonly MatchRoundScore[]>,
): TeamStanding[] {
  // 初始化每支队伍的数据
  const stats = new Map<string, { wins: number; losses: number; netRounds: number; totalRoundsWon: number }>();
  for (const t of competitionEntries) {
    stats.set(t.id, { wins: 0, losses: 0, netRounds: 0, totalRoundsWon: 0 });
  }

  for (const m of finishedMatches) {
    const a = stats.get(m.entryAId);
    const b = stats.get(m.entryBId);
    if (!a || !b || m.scoreA === null || m.scoreB === null) continue;

    const scoreA = m.scoreA;
    const scoreB = m.scoreB;

    for (const mapScore of roundScoresByMatchId.get(m.id) ?? []) {
      a.totalRoundsWon += mapScore.scoreA;
      b.totalRoundsWon += mapScore.scoreB;
      a.netRounds += mapScore.scoreA - mapScore.scoreB;
      b.netRounds += mapScore.scoreB - mapScore.scoreA;
    }
    if (scoreA > scoreB) { a.wins++; b.losses++; }
    else { b.wins++; a.losses++; }
  }

  const standings: TeamStanding[] = competitionEntries.map((t) => {
    const s = stats.get(t.id)!;
    return { teamId: t.id, teamName: t.name, draftOrder: t.formationOrder, ...s, seed: 0 };
  });

  // 排序：胜场 → 净胜回合 → 相互战绩 → 总胜回合 → draftOrder（稳定）
  standings.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.netRounds !== a.netRounds) return b.netRounds - a.netRounds;

    // 相互战绩：查 finishedMatches 中两队之间的比赛
    const h2h = finishedMatches.find(
      (m) =>
        (m.entryAId === a.teamId && m.entryBId === b.teamId) ||
        (m.entryAId === b.teamId && m.entryBId === a.teamId),
    );
    if (h2h && h2h.scoreA !== null && h2h.scoreB !== null && h2h.scoreA !== h2h.scoreB) {
      const aWonH2H =
        (h2h.entryAId === a.teamId && (h2h.scoreA ?? 0) > (h2h.scoreB ?? 0)) ||
        (h2h.entryBId === a.teamId && (h2h.scoreB ?? 0) > (h2h.scoreA ?? 0));
      if (aWonH2H) return -1;
      return 1;
    }

    if (b.totalRoundsWon !== a.totalRoundsWon) return b.totalRoundsWon - a.totalRoundsWon;

    // 最终 fallback：draftOrder（选秀顺位）
    return (a.draftOrder ?? Number.MAX_SAFE_INTEGER) - (b.draftOrder ?? Number.MAX_SAFE_INTEGER);
  });

  standings.forEach((s, i) => { s.seed = i + 1; });
  return standings;
}

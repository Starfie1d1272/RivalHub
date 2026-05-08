import {
  DRAFT_TOTAL_ROUNDS,
  DRAFT_TEAMS,
} from "@/types/draft";

export interface DraftTeamOrder {
  id: string;
  draftOrder: number;
}

/**
 * 获取指定轮次的蛇形选秀顺序
 * 奇数轮正向（draftOrder 升序），偶数轮反向（draftOrder 降序）
 */
export function getSnakeOrder(
  teams: DraftTeamOrder[],
  round: number,
): DraftTeamOrder[] {
  const sorted = [...teams].sort((a, b) => a.draftOrder - b.draftOrder);
  return round % 2 === 1 ? sorted : sorted.reverse();
}

/**
 * 获取当前队的下一队 ID（用于 draft_state 推进）
 * 同一轮内按蛇形顺序推进，轮末翻转到下一轮
 */
export function getNextTeamId(
  teams: DraftTeamOrder[],
  currentTeamId: string,
  round: number,
): { teamId: string; nextRound: number } | null {
  const order = getSnakeOrder(teams, round);
  const idx = order.findIndex((t) => t.id === currentTeamId);
  if (idx === -1) return null;

  // 本轮还有下一队
  if (idx < order.length - 1) {
    return { teamId: order[idx + 1].id, nextRound: round };
  }

  // 本队是轮末 → 下一轮
  const nextRound = round + 1;
  if (nextRound > DRAFT_TOTAL_ROUNDS) return null; // 已完成

  const nextOrder = getSnakeOrder(teams, nextRound);
  return { teamId: nextOrder[0].id, nextRound };
}

/**
 * 判断选秀是否全部完成
 */
export function isDraftComplete(
  round: number,
  currentTeamId: string | null,
  totalPicks: number,
): boolean {
  return (
    totalPicks >= DRAFT_TOTAL_ROUNDS * DRAFT_TEAMS ||
    (round > DRAFT_TOTAL_ROUNDS && !currentTeamId)
  );
}

/**
 * 统计每队各主选位置人数
 * 返回 Map<teamId, Map<position, count>>
 */
export function computeTeamPositionCounts(
  members: { teamId: string; primaryPosition: string }[],
): Map<string, Map<string, number>> {
  const byTeam = new Map<string, Map<string, number>>();
  for (const m of members) {
    let teamMap = byTeam.get(m.teamId);
    if (!teamMap) {
      teamMap = new Map();
      byTeam.set(m.teamId, teamMap);
    }
    teamMap.set(m.primaryPosition, (teamMap.get(m.primaryPosition) ?? 0) + 1);
  }
  return byTeam;
}

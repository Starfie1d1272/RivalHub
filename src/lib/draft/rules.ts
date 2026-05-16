import {
  DRAFT_TOTAL_ROUNDS,
  DRAFT_TEAMS,
} from "@/types/draft";

export const DRAFT_POSITION_LIMIT_PER_TEAM = 2;

export interface DraftTeamOrder {
  id: string;
  draftOrder: number;
}

/**
 * 获取指定轮次的蛇形选秀顺序
 * 奇数轮反向（draftOrder 降序，后位先选），偶数轮正向（draftOrder 升序）
 */
export function getSnakeOrder(
  teams: DraftTeamOrder[],
  round: number,
): DraftTeamOrder[] {
  const sorted = [...teams].sort((a, b) => a.draftOrder - b.draftOrder);
  return round % 2 === 1 ? sorted.reverse() : sorted;
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

/**
 * Round 1-4 是首发 pick；Round 5-6 是替补 pick。
 * 队长在 confirmCaptains 时已作为首发写入 team_members。
 */
export function isStarterRound(round: number): boolean {
  return round >= 1 && round <= 4;
}

/**
 * 每队同一主选位置最多 2 人，包含队长本人。
 */
export function canPickPosition(
  currentCount: number,
  limit = DRAFT_POSITION_LIMIT_PER_TEAM,
): boolean {
  return currentCount < limit;
}

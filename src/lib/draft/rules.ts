import {
  DRAFT_TOTAL_ROUNDS,
  DRAFT_TEAMS,
  DRAFT_ROUND_TIMEOUT_SECONDS,
} from "@/types/draft";
import type { DecodedSeasonRules } from "@/lib/seasons/rules";

/** Historical formats keep their published interpretation. */
export function draftFormat(rules: DecodedSeasonRules) {
  if (rules.source !== "policy_v2") return { teamCount: DRAFT_TEAMS, rounds: DRAFT_TOTAL_ROUNDS, starterPicks: 4, timeoutSeconds: DRAFT_ROUND_TIMEOUT_SECONDS };
  const starterPicks = Math.max(0, rules.lineup.starterCount - 1);
  return {
    teamCount: rules.formation.hasCaptainVoting ? (rules.formation.settings?.targetTeamCount ?? 0) : 0,
    rounds: (rules.formation.settings?.targetRosterSize ?? 0) - 1,
    starterPicks,
    timeoutSeconds: rules.formation.settings!.draftTimeoutSeconds,
  };
}

const DRAFT_POSITION_LIMIT_PER_TEAM = 2;

export function getPositionCount(counts: Readonly<Record<string, number>>, position: string): number {
  return Object.hasOwn(counts, position) ? counts[position] : 0;
}

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
export function getNextEntryId(
  teams: DraftTeamOrder[],
  currentEntryId: string,
  round: number,
  totalRounds: number,
): { entryId: string; nextRound: number } | null {
  const order = getSnakeOrder(teams, round);
  const idx = order.findIndex((t) => t.id === currentEntryId);
  if (idx === -1) return null;

  // 本轮还有下一队
  if (idx < order.length - 1) {
    return { entryId: order[idx + 1].id, nextRound: round };
  }

  // 本队是轮末 → 下一轮
  const nextRound = round + 1;
  if (nextRound > totalRounds) return null; // 已完成

  const nextOrder = getSnakeOrder(teams, nextRound);
  return { entryId: nextOrder[0].id, nextRound };
}

/**
 * 统计每队各主选位置人数
 * 返回 Map<entryId, Map<position, count>>
 */
export function computeTeamPositionCounts(
  members: { entryId: string; primaryPosition: string }[],
): Map<string, Map<string, number>> {
  const byTeam = new Map<string, Map<string, number>>();
  for (const m of members) {
    let teamMap = byTeam.get(m.entryId);
    if (!teamMap) {
      teamMap = new Map();
      byTeam.set(m.entryId, teamMap);
    }
    teamMap.set(m.primaryPosition, (teamMap.get(m.primaryPosition) ?? 0) + 1);
  }
  return byTeam;
}

/**
 * Round 1-4 是首发 pick；Round 5-6 是替补 pick。
 * 队长在 confirmCaptains 时已作为首发写入赛事名单。
 */
export function isStarterRound(round: number, starterPicks: number): boolean {
  return round >= 1 && round <= starterPicks;
}

/**
 * 每队同一主选位置最多 2 人，包含队长本人。
 */
export function canPickPosition(
  currentCount: number,
  limit = DRAFT_POSITION_LIMIT_PER_TEAM,
): boolean {
  return limit <= 0 || currentCount < limit;
}

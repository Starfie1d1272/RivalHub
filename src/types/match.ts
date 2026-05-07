// 共享比赛类型

export type MatchStatus = "scheduled" | "in_progress" | "finished" | "cancelled";

export interface Match {
  id: string;
  seasonId: string;
  teamAId: string;
  teamBId: string;
  scoreA: number | null;
  scoreB: number | null;
  status: MatchStatus;
  bracketNodeId: string | null;  // brackets-manager 节点引用
  scheduledAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 比赛状态中文标签 */
export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  scheduled: "已排期",
  in_progress: "进行中",
  finished: "已结束",
  cancelled: "已取消",
};

/**
 * 比赛结果工具
 * 返回赢家 teamId，平局时返回 null
 */
export function getWinner(match: Match): string | null {
  if (match.status !== "finished") return null;
  if (match.scoreA == null || match.scoreB == null) return null;
  if (match.scoreA > match.scoreB) return match.teamAId;
  if (match.scoreB > match.scoreA) return match.teamBId;
  return null; // 平局
}

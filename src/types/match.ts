// 共享比赛类型

export type MatchStatus = "scheduled" | "in_progress" | "finished" | "cancelled";
export type MatchStage = string;
export type MatchFormat = "bo1" | "bo3" | "bo5";
export type Side = "t" | "ct";

export const SIDE_LABELS: Record<Side, string> = { t: "T 方", ct: "CT 方" };

export interface Match {
  id: string;
  seasonId: string;
  teamAId: string;
  teamBId: string;
  stage: MatchStage;
  round: number | null;
  format: MatchFormat;
  /** 系列赛比分（如 BO3 中 2:1）；单图比分见 MatchMap */
  scoreA: number | null;
  scoreB: number | null;
  status: MatchStatus;
  bracketNodeId: string | null;
  scheduledAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MatchMap {
  id: string;
  matchId: string;
  /** 第几张图（1-based，最大 5）*/
  mapOrder: number;
  /** 地图代号，如 "de_inferno" */
  mapName: string;
  /** 该图被哪支队 pick；决胜图为 null */
  pickedByTeamId: string | null;
  /** Team A 上半场起始边 */
  teamAStartSide: Side | null;
  scoreA: number | null;
  scoreB: number | null;
  completedAt: Date | null;
  createdAt: Date;
}

// ── 标签 ─────────────────────────────────────────────────────────────────

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  scheduled: "待进行",
  in_progress: "进行中",
  finished: "已结束",
  cancelled: "已取消",
};

export const MATCH_STAGE_LABELS: Record<string, string> = {
  qualifier: "排位赛",
  playoff: "正赛",
};

export const MATCH_FORMAT_LABELS: Record<MatchFormat, string> = {
  bo1: "BO1",
  bo3: "BO3",
  bo5: "BO5",
};

// ── BP 流程定义（来自规则书 §5.3）────────────────────────────────────────
// 仅类型定义，实际 BP 状态机为后续阶段
export type VetoActionType = "ban" | "pick" | "side_pick" | "decider";

/** 每种 format 的 BP 步骤数（用于 UI 进度条 / 校验）*/
export const VETO_STEP_COUNT: Record<MatchFormat, number> = {
  bo1: 7,   // ban×6 + decider
  bo3: 7,   // ban×2 + pick×2 + ban×2 + decider
  bo5: 7,   // ban×2 + pick×4 + decider（knife round）
};

// ── 工具函数 ─────────────────────────────────────────────────────────────

/** 系列赛胜者 teamId；平局或未结束返回 null */
export function getWinner(match: Match): string | null {
  if (match.status !== "finished") return null;
  if (match.scoreA == null || match.scoreB == null) return null;
  if (match.scoreA > match.scoreB) return match.teamAId;
  if (match.scoreB > match.scoreA) return match.teamBId;
  return null;
}

/** 该 format 最多地图数 */
export function getMaxMaps(format: MatchFormat): number {
  switch (format) {
    case "bo1": return 1;
    case "bo3": return 3;
    case "bo5": return 5;
  }
}

/** 该 format 系列赛获胜所需的图数 */
export function getWinThreshold(format: MatchFormat): number {
  switch (format) {
    case "bo1": return 1;
    case "bo3": return 2;
    case "bo5": return 3;
  }
}

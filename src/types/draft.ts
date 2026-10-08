// 共享选秀类型

export interface DraftState {
  id: string;
  seasonId: string;
  currentRound: number;       // 当前轮次（1-6）
  currentEntryId: string | null;
  roundDeadline: Date | null;
  isActive: boolean;
  updatedAt: Date;
}

export interface DraftPick {
  id: string;
  seasonId: string;
  entryId: string;
  registrationId: string;
  round: number;
  pickNumber: number;
  autoPicked: boolean;
  clientRequestId: string | null;
  createdAt: Date;
}

/** 蛇形选秀常量 */
export const DRAFT_TOTAL_ROUNDS = 6;
export const DRAFT_TEAMS = 8;
export const DRAFT_ROUND_TIMEOUT_SECONDS = 180; // 3 分钟

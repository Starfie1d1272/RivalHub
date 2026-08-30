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

/**
 * 计算蛇形顺序中第 round 轮、第 entryIdx 队（0-based）的全局 pick 序号
 * 奇数轮 (round % 2 === 1)：正向 0→7
 * 偶数轮：反向 7→0
 */
export function getPickNumber(round: number, entryIdx: number): number {
  const roundOffset = (round - 1) * DRAFT_TEAMS;
  const isForward = round % 2 === 1;
  return roundOffset + (isForward ? entryIdx : DRAFT_TEAMS - 1 - entryIdx) + 1;
}

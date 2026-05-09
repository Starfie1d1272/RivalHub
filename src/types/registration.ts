// 共享报名类型

export type Position = "igl" | "awper" | "opener" | "closer" | "anchor";

export type RegistrationStatus = "pending" | "approved" | "rejected" | "waitlisted";

export interface Registration {
  id: string;
  userId: string;
  seasonId: string;
  primaryPosition: Position;
  secondaryPosition: Position | null;
  peakRating: number | null;
  playerType: "enrolled" | "graduated" | "external";
  screenshotUrls: string[];
  status: RegistrationStatus;
  willingToBeCaptain: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export { POSITION_LABELS } from "@/lib/validators/registration";

/** 审核状态中文标签 */
export const REGISTRATION_STATUS_LABELS: Record<RegistrationStatus, string> = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
  waitlisted: "等待名单",
};

/** 每个位置的报名上限 */
export const POSITION_CAP = 15;

/** 每队同一主选位置的最大人数（选秀约束） */
export const TEAM_POSITION_CAP = 3;

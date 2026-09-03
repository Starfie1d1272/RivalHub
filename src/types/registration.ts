import type { MapPreference } from "@/types/season";

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
  mapPreferences: MapPreference[];
  status: RegistrationStatus;
  willingToBeCaptain: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 审核状态中文标签 */
export const REGISTRATION_STATUS_LABELS: Record<RegistrationStatus, string> = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
  waitlisted: "候补名单",
};

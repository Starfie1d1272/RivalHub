import type { SeasonStatus } from "@/types/season";

type RegistrationWindowSeason = {
  status: SeasonStatus;
  startAt: Date | string | null;
  registrationDeadline: Date | string | null;
};

export type RegistrationWindowPhase =
  | "hidden"
  | "upcoming"
  | "open"
  | "closed";

export interface RegistrationWindowState {
  phase: RegistrationWindowPhase;
  canViewForm: boolean;
  canSaveDraft: boolean;
  canSubmit: boolean;
  message: string;
}

function toTime(value: Date | string | null): number | null {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

export function getWindowTone(phase: RegistrationWindowPhase, canSubmit: boolean): "success" | "warn" | "info" {
  if (canSubmit) return "success";
  if (phase === "closed") return "warn";
  return "info";
}

export function getRegistrationWindowState(
  season: RegistrationWindowSeason,
  now: Date = new Date(),
): RegistrationWindowState {
  if (season.status !== "registration") {
    return {
      phase: "hidden",
      canViewForm: false,
      canSaveDraft: false,
      canSubmit: false,
      message: "报名通道当前不可用。",
    };
  }

  const nowTime = now.getTime();
  const startTime = toTime(season.startAt);
  const deadlineTime = toTime(season.registrationDeadline);

  if (deadlineTime !== null && nowTime >= deadlineTime) {
    return {
      phase: "closed",
      canViewForm: true,
      canSaveDraft: false,
      canSubmit: false,
      message: "报名提交已截止。",
    };
  }

  if (startTime !== null && nowTime < startTime) {
    return {
      phase: "upcoming",
      canViewForm: true,
      canSaveDraft: true,
      canSubmit: false,
      message: "报名提交尚未开放，可以先保存草稿。",
    };
  }

  return {
    phase: "open",
    canViewForm: true,
    canSaveDraft: true,
    canSubmit: true,
    message: "报名提交已开放。",
  };
}

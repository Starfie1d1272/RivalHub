import type { SeasonStatus } from "@/types/season";

type RegistrationWindowSeason = {
  status: SeasonStatus;
  registrationOpensAt: Date | string | null;
  registrationOpenedAt?: Date | string | null;
  registrationClosesAt: Date | string | null;
  rosterChangeClosesAt?: Date | string | null;
};

export type RegistrationWindowPhase =
  | "hidden"
  | "unscheduled"
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

/** One canonical self-service boundary for approved CompetitionEntry rosters. */
export function canSelfManageEventRoster(
  season: Pick<RegistrationWindowSeason, "status" | "registrationClosesAt" | "rosterChangeClosesAt">,
  now: Date = new Date(),
): boolean {
  if (season.status !== "registration") return false;
  const deadline = toTime(season.rosterChangeClosesAt ?? season.registrationClosesAt);
  return deadline === null || now.getTime() < deadline;
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
  const startTime = toTime(season.registrationOpensAt);
  const openedTime = toTime(season.registrationOpenedAt ?? null);
  const deadlineTime = toTime(season.registrationClosesAt);

  if (startTime === null) {
    return {
      phase: "unscheduled",
      canViewForm: true,
      canSaveDraft: false,
      canSubmit: false,
      message: "报名开放时间待定。",
    };
  }

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
      canSaveDraft: false,
      canSubmit: false,
      message: "报名尚未开放。",
    };
  }

  if (openedTime === null) {
    return {
      phase: "upcoming",
      canViewForm: true,
      canSaveDraft: false,
      canSubmit: false,
      message: "报名开放正在确认中，请稍后刷新。",
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

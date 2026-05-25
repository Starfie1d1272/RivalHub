import { AppError, ErrorCode } from "@/lib/errors";

export type RegistrationStatus = "pending" | "approved" | "rejected" | "waitlisted";

type TransitionKey = `${RegistrationStatus}→${RegistrationStatus}`;

export interface TransitionRule {
  /** 空数组 = 任意赛季阶段都允许 */
  allowedSeasonStatuses: string[];
}

export const TRANSITION_RULES: Partial<Record<TransitionKey, TransitionRule>> = {
  "pending→approved":    { allowedSeasonStatuses: ["registration", "voting"] },
  "pending→rejected":    { allowedSeasonStatuses: [] },
  "pending→waitlisted":  { allowedSeasonStatuses: ["registration"] },
  "waitlisted→approved": { allowedSeasonStatuses: ["registration", "voting"] },
  "waitlisted→rejected": { allowedSeasonStatuses: [] },
  "approved→pending":    { allowedSeasonStatuses: ["registration"] },
  "approved→rejected":   { allowedSeasonStatuses: ["registration", "voting"] },
  "rejected→approved":   { allowedSeasonStatuses: ["registration"] },
  "rejected→pending":    { allowedSeasonStatuses: ["registration"] },
};

export function validateTransition(
  current: RegistrationStatus,
  target: RegistrationStatus,
  seasonStatus: string,
): void {
  const key = `${current}→${target}` as TransitionKey;
  const rule = TRANSITION_RULES[key];

  if (!rule) {
    throw new AppError(
      ErrorCode.REGISTRATION_INVALID_TRANSITION,
      `不允许从 ${current} 变更为 ${target}`,
    );
  }

  const allowed = rule.allowedSeasonStatuses;
  if (allowed.length > 0 && !allowed.includes(seasonStatus)) {
    throw new AppError(
      ErrorCode.SEASON_INVALID_STATUS,
      `当前赛季状态不允许此操作（${seasonStatus}）`,
    );
  }
}

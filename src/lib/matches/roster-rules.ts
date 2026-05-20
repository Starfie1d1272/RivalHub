import { AppError, ErrorCode } from "@/lib/errors";

export function validateRosterSelection(starterIds: string[], substituteIds: string[] = []): void {
  if (starterIds.length !== 5) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "必须选择 5 名首发");
  }
  if (substituteIds.length > 2) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "替补不能超过 2 人");
  }
}

export function assertRosterSubmissionOpen(scheduledAt: Date | null, now = new Date()): void {
  if (!scheduledAt) return;
  const hoursUntilMatch = (scheduledAt.getTime() - now.getTime()) / (1000 * 60 * 60);
  if (hoursUntilMatch < 2) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "距开赛不足 2 小时，无法提交名单");
  }
}

export function assertAllMembersBelongToTeam(
  requestedMemberIds: string[],
  ownedMemberIds: string[],
): void {
  if (ownedMemberIds.length !== new Set(requestedMemberIds).size) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "队员不属于本队");
  }
}

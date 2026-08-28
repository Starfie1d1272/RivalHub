import { AppError, ErrorCode } from "@/lib/errors";

export function validateRosterSelection(starterIds: string[], substituteIds: string[] = [], allowSubstitutes = true): void {
  if (starterIds.length !== 5) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "必须选择 5 名首发");
  }
  if (!allowSubstitutes && substituteIds.length > 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "本赛事每队本场只能提交恰好 5 名首发，不设置替补名单");
  }
  if (allowSubstitutes && substituteIds.length > 2) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "历史赛制替补不能超过 2 人");
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

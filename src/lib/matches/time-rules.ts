import { AppError, ErrorCode } from "@/lib/errors";

export const TIME_CONFIRMATION_BUFFER_HOURS = 24;

export function getTimeConfirmationCutoff(completionDeadline: Date | null): Date | null {
  if (!completionDeadline) return null;
  return new Date(completionDeadline.getTime() - TIME_CONFIRMATION_BUFFER_HOURS * 60 * 60 * 1000);
}

export function assertBeforeTimeConfirmationCutoff(
  completionDeadline: Date | null,
  now = new Date(),
): void {
  const cutoff = getTimeConfirmationCutoff(completionDeadline);
  if (cutoff && now.getTime() >= cutoff.getTime()) {
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      "时间协商已截止，请联系管理员指定比赛时间",
    );
  }
}

export function assertProposedTimeFitsDeadline(
  proposedTime: Date,
  completionDeadline: Date | null,
  now = new Date(),
): void {
  if (Number.isNaN(proposedTime.getTime())) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "请输入有效的比赛时间");
  }
  if (proposedTime.getTime() <= now.getTime()) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "比赛时间必须晚于当前时间");
  }
  if (completionDeadline && proposedTime.getTime() > completionDeadline.getTime()) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "比赛时间不能晚于最晚完成时间");
  }
}

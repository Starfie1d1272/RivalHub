import { AppError, ErrorCode } from "@/lib/errors";
import { getStageByKey, type StagePlan } from "@/types/season";

export const TIME_CONFIRMATION_BUFFER_HOURS = 24;

/**
 * 根据比赛所属阶段返回协商缓冲小时数。
 * 排位赛通常给较长窗口（默认 24h 缓冲，方便补打），正赛阶段窗口紧，取消缓冲。
 */
export function getTimeBufferHoursForStage(
  stagePlan: StagePlan | null | undefined,
  stageKey: string,
): number {
  const stage = getStageByKey(stagePlan, stageKey);
  if (!stage) return TIME_CONFIRMATION_BUFFER_HOURS;
  if (stage.type === "double_elim" || stage.type === "single_elim") return 0;
  return TIME_CONFIRMATION_BUFFER_HOURS;
}

export function getTimeConfirmationCutoff(
  completionDeadline: Date | null,
  bufferHours: number = TIME_CONFIRMATION_BUFFER_HOURS,
): Date | null {
  if (!completionDeadline) return null;
  return new Date(completionDeadline.getTime() - bufferHours * 60 * 60 * 1000);
}

export function assertBeforeTimeConfirmationCutoff(
  completionDeadline: Date | null,
  bufferHours: number = TIME_CONFIRMATION_BUFFER_HOURS,
  now = new Date(),
): void {
  const cutoff = getTimeConfirmationCutoff(completionDeadline, bufferHours);
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

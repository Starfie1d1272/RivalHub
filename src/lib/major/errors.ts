import { AppError, type ErrorCode } from "@/lib/errors";

export type MajorErrorKey =
  | "incompleteSwissResults"
  | "invalidSwissResults"
  | "playoffNotReady"
  | "sourceStageNotFound"
  | "sourceStageIncomplete"
  | "nextStageUnavailable";

const MESSAGES = {
  incompleteSwissResults: "当前 Swiss 阶段仍有未完成或没有正式比分的比赛。",
  invalidSwissResults: "当前 Swiss 阶段存在不合法的正式比分。",
  playoffNotReady: "当前淘汰赛阶段还不能开始运行。",
  sourceStageNotFound: "指定的赛事阶段不属于当前赛事。",
  sourceStageIncomplete: "只有已完成全部五轮的 Swiss 阶段才能进入下一阶段。",
  nextStageUnavailable: "当前 Swiss 阶段后没有可切换的下一阶段。",
} satisfies Record<MajorErrorKey, string>;

export function majorAppError(
  code: ErrorCode,
  key: MajorErrorKey,
  params: Record<string, string | number | boolean | null> = {},
): AppError {
  return AppError.withPresentation(code, {
    owner: "major",
    key,
    params,
    message: MESSAGES[key],
  });
}

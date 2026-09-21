import { AppError, ErrorCode } from "@/lib/errors";

export function matchCorrectionBlockedError(blockedReasons: readonly string[]): AppError {
  const reasonText = blockedReasons.join("；");
  return AppError.withPresentation(
    ErrorCode.VALIDATION_FAILED,
    {
      owner: "match-corrections",
      key: "automaticRecoveryBlocked",
      params: { reasonCount: blockedReasons.length },
      message: reasonText ? `该更正暂时不能自动应用：${reasonText}` : "该更正暂时不能自动应用。",
    },
    { diagnostic: "Match correction requires operator adjudication before recovery." },
  );
}

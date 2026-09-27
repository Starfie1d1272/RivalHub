import { AppError, ErrorCode } from "@/lib/errors";

type EmptyParams = Readonly<Record<string, never>>;

export type MatchCorrectionBlocker =
  | { code: "nonManagedMatch"; params: EmptyParams }
  | { code: "downstreamStageMaterialized"; params: { stageKey: string } }
  | { code: "finalResultsPublished"; params: EmptyParams }
  | { code: "downstreamMatchStarted"; params: { count: number } }
  | { code: "qualificationFinalEntrants"; params: EmptyParams }
  | { code: "qualificationMatchStarted"; params: { count: number } };

const MESSAGES = {
  nonManagedMatch: "非托管比赛的胜者更正会与既有赛程矛盾，必须通过赛事事故裁决处理。",
  downstreamStageMaterialized: "后续阶段已经基于本阶段结果建立，不能自动重建；需要走赛后裁决。",
  finalResultsPublished: "官方名次已经生成，胜者更正被禁止；请使用赛后裁决操作。",
  downstreamMatchStarted: "存在 {count} 场已经开始或完成的下游托管比赛，系统拒绝自动重写；需要走赛后裁决并人工恢复。",
  qualificationFinalEntrants: "正赛参赛名单已经产生，资格赛胜者更正需要通过赛事事故裁决处理。",
  qualificationMatchStarted: "存在 {count} 场已经开始或完成的后续资格赛比赛，系统拒绝自动重写；需要走赛事事故裁决。",
} satisfies Record<MatchCorrectionBlocker["code"], string>;

export function presentMatchCorrectionBlocker(reason: MatchCorrectionBlocker): string {
  const message = MESSAGES[reason.code];
  return reason.code === "downstreamMatchStarted"
    ? message.replace("{count}", String(reason.params.count))
    : message;
}

function diagnosticFor(reason: MatchCorrectionBlocker): string {
  switch (reason.code) {
    case "nonManagedMatch":
      return "non_managed_match: 非托管比赛的胜者更正会与既有赛程矛盾，必须通过赛事事故裁决处理。";
    case "downstreamStageMaterialized":
      return `downstream_stage_materialized: 后续阶段 ${reason.params.stageKey} 已基于本阶段结果建立，不能自动重建；需要走赛后裁决。`;
    case "finalResultsPublished":
      return "final_results_published: 官方名次已经生成，胜者更正被禁止；请使用赛后裁决操作。";
    case "downstreamMatchStarted":
      return `downstream_match_started: ${reason.params.count} 场已经开始或完成的下游托管比赛，系统拒绝自动重写。`;
    case "qualificationFinalEntrants":
      return "qualification_final_entrants: 正赛参赛名单已经产生，资格赛胜者更正需要通过赛事事故裁决处理。";
    case "qualificationMatchStarted":
      return `qualification_match_started: ${reason.params.count} 场已经开始或完成的后续资格赛比赛，系统拒绝自动重写。`;
  }
}

export function matchCorrectionBlockedError(blockedReasons: readonly MatchCorrectionBlocker[]): AppError {
  const productMessage = blockedReasons.map(presentMatchCorrectionBlocker).join("；");
  const diagnostic = blockedReasons.map(diagnosticFor).join("; ");
  return AppError.withPresentation(
    ErrorCode.VALIDATION_FAILED,
    {
      owner: "match-corrections",
      key: "automaticRecoveryBlocked",
      params: { reasonCount: blockedReasons.length },
      message: productMessage ? `该更正暂时不能自动应用：${productMessage}` : "该更正暂时不能自动应用。",
    },
    { diagnostic: diagnostic || "automatic_recovery_blocked: no blocker details" },
  );
}

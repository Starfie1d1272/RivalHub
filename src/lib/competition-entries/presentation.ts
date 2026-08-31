export type CompetitionEntryRegistrationStatus =
  | "draft"
  | "submitted"
  | "changes_requested"
  | "waitlisted"
  | "approved"
  | "rejected"
  | "withdrawn";

export type CompetitionEntryParticipantStatus = "invited" | "confirmed" | "declined" | "withdrawn";
export type CompetitionEntryPresentationState = "ready" | "incomplete" | "waiting" | "blocked";

export interface CompetitionEntryPresentation {
  label: string;
  state: CompetitionEntryPresentationState;
  detail: string;
  tone: SemanticTone;
}

export function presentCompetitionEntryRegistration(
  status: CompetitionEntryRegistrationStatus,
): CompetitionEntryPresentation {
  switch (status) {
    case "approved":
      return { label: "已批准", state: "ready", detail: "报名已获批准。赛事 roster 与单场出场仍是独立事实。", tone: "success" };
    case "submitted":
      return { label: "已提交", state: "waiting", detail: "报名已提交，正在等待审核。", tone: "info" };
    case "waitlisted":
      return { label: "候补", state: "waiting", detail: "报名当前处于候补状态。", tone: "warn" };
    case "changes_requested":
      return { label: "需补正", state: "blocked", detail: "审核要求补正报名材料或名单。", tone: "warn" };
    case "rejected":
      return { label: "未通过", state: "blocked", detail: "报名未通过；请查看审核说明。", tone: "danger" };
    case "withdrawn":
      return { label: "已撤回", state: "blocked", detail: "本届报名已撤回。", tone: "neutral" };
    case "draft":
      return { label: "草稿", state: "incomplete", detail: "报名仍在草稿阶段，尚未提交审核。", tone: "neutral" };
  }
}

export function presentCompetitionEntryParticipation(
  participantStatus: CompetitionEntryParticipantStatus | null,
  registrationStatus: CompetitionEntryRegistrationStatus,
): CompetitionEntryPresentation {
  if (participantStatus === "confirmed") {
    return { label: "已确认参赛", state: "ready", detail: "你已确认参加本届赛事；最终报名状态由赛事负责人和审核决定。", tone: "success" };
  }
  if (participantStatus === "invited") {
    return registrationStatus === "changes_requested"
      ? { label: "需要重新确认", state: "waiting", detail: "报名补正后你需要重新确认是否参加本届赛事。", tone: "warn" }
      : { label: "被邀请待确认", state: "waiting", detail: "你已被邀请但尚未确认参加本届赛事。", tone: "info" };
  }
  if (participantStatus === "declined") {
    return { label: "已拒绝", state: "blocked", detail: "你已拒绝参加本届赛事；如需参赛，请由赛事负责人重新加入名单。", tone: "danger" };
  }
  if (participantStatus === "withdrawn") {
    return { label: "已退出", state: "blocked", detail: "你已退出本届赛事；如需参赛，请由赛事负责人重新加入名单。", tone: "neutral" };
  }
  return { label: "未在当前名单", state: "blocked", detail: "你当前未确认参加本届赛事。", tone: "neutral" };
}
import type { SemanticTone } from "@/lib/presentation";

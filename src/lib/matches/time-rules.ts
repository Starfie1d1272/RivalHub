import { AppError, ErrorCode } from "@/lib/errors";

export const PROPOSAL_RESPONSE_HOURS = 24;
export const AUTO_ACCEPT_NOTICE_HOURS = 2;
const HOUR_MS = 60 * 60_000;

export interface SchedulingFacts {
  status: string;
  scheduledAt: Date | null;
  completionDeadline: Date | null;
}
export interface PendingTimeProposal {
  createdAt: Date;
  proposedTime: Date;
}

/** Runtime safety shared by the worker and read-only scheduling projections. */
export function getProposalAutoAcceptAt(
  match: SchedulingFacts,
  proposal: PendingTimeProposal,
): Date | null {
  if (match.status !== "scheduled" || match.scheduledAt) return null;
  const dueAt = new Date(proposal.createdAt.getTime() + PROPOSAL_RESPONSE_HOURS * HOUR_MS);
  if (proposal.proposedTime.getTime() < dueAt.getTime() + AUTO_ACCEPT_NOTICE_HOURS * HOUR_MS) return null;
  if (match.completionDeadline && proposal.proposedTime > match.completionDeadline) return null;
  return dueAt;
}

export function canAutoAcceptProposal(match: SchedulingFacts, proposal: PendingTimeProposal, now: Date): boolean {
  const dueAt = getProposalAutoAcceptAt(match, proposal);
  return dueAt !== null && now >= dueAt &&
    proposal.proposedTime.getTime() >= now.getTime() + AUTO_ACCEPT_NOTICE_HOURS * HOUR_MS;
}

export function projectMatchScheduling(match: SchedulingFacts, pending: PendingTimeProposal | null, now = new Date()) {
  const active = match.status === "scheduled";
  const validPending = active && pending && pending.proposedTime > now &&
    (!match.completionDeadline || pending.proposedTime <= match.completionDeadline) ? pending : null;
  return {
    state: !active ? "inactive" : validPending ? (match.scheduledAt ? "reschedule_pending" : "pending") : match.scheduledAt ? "confirmed" : "unproposed",
    pending: validPending,
    autoAcceptAt: validPending ? getProposalAutoAcceptAt(match, validPending) : null,
  } as const;
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

import "server-only";
import { canSelfChangeApprovedRoster, getRegistrationWindowState, type RegistrationWindowSeason } from "@/lib/registration/window";
import { canMutateCompetitionEntryRoster, type CompetitionEntryRosterRevisionOrigin } from "./remediation";
import type { CompetitionEntryRegistrationStatus } from "./presentation";

export function getCompetitionEntryCapabilities(input: {
  season: RegistrationWindowSeason;
  entry: { status: CompetitionEntryRegistrationStatus; hasApprovedRoster: boolean } | null;
  revision: { status: string; origin: CompetitionEntryRosterRevisionOrigin } | null;
  rosterFrozen: boolean;
}, now = new Date()) {
  const { season, entry, revision, rosterFrozen } = input;
  const window = getRegistrationWindowState(season, now);
  const editable = !rosterFrozen && !!entry && !!revision && revision.status === "draft"
    && (entry.status === "draft" || entry.status === "changes_requested")
    && canMutateCompetitionEntryRoster(entry.status, revision.origin, season, now);
  const canRequestRosterChange = !rosterFrozen && entry?.status === "approved"
    && entry.hasApprovedRoster && canSelfChangeApprovedRoster(season, now);
  const canWithdrawParticipation = !rosterFrozen && !!entry
    && (entry.status !== "approved" || (entry.hasApprovedRoster && canSelfChangeApprovedRoster(season, now)));
  const canWithdrawFromReview = !rosterFrozen && entry?.status === "submitted"
    && revision?.status === "submitted" && window.canSubmit;
  const rosterChangeClosed = !canSelfChangeApprovedRoster(season, now);
  return {
    canStartRegistration: !entry && window.canSubmit,
    canEditCurrentRoster: editable,
    canSubmitForReview: editable,
    canWithdrawFromReview,
    canWithdrawParticipation,
    canRequestRosterChange,
    canConfirmParticipation: editable,
    canRespondToAdminRemediation: editable && revision?.origin === "admin_remediation",
    readOnlyReason: rosterFrozen ? "最终名单已锁定；如需处理名单或参赛状态，请联系赛事管理员。" : editable || canRequestRosterChange ? null
      : entry?.status === "approved" || (entry?.status === "changes_requested" && revision?.origin === "self_roster_change")
        ? rosterChangeClosed ? "名单调整已截止；如需处理名单或参赛状态，请联系赛事管理员。" : "当前名单暂不可自行调整，请联系赛委会。"
        : window.canSubmit ? null : window.message,
  };
}

export type CompetitionEntryCapabilities = ReturnType<typeof getCompetitionEntryCapabilities>;

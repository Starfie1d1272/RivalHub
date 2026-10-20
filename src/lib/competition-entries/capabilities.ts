import "server-only";
import { canSelfChangeApprovedRoster, getRegistrationWindowState, type RegistrationWindowSeason } from "@/lib/registration/window";
import { canMutateCompetitionEntryRoster, type CompetitionEntryRosterRevisionOrigin } from "./remediation";
import type { CompetitionEntryRegistrationStatus } from "./presentation";

export function getCompetitionEntryCapabilities(input: {
  season: RegistrationWindowSeason;
  entry: { status: CompetitionEntryRegistrationStatus; hasApprovedRoster: boolean } | null;
  revision: { status: string; origin: CompetitionEntryRosterRevisionOrigin } | null;
  rosterFrozen: boolean;
  majorAdjustmentPhaseOpen?: boolean;
  eliminatedParticipationRelease?: boolean;
}, now = new Date()) {
  const { season, entry, revision, rosterFrozen, majorAdjustmentPhaseOpen = true } = input;
  const window = getRegistrationWindowState(season, now);
  const editable = !rosterFrozen && !!entry && !!revision && revision.status === "draft"
    && (entry.status === "draft" || entry.status === "changes_requested")
    && canMutateCompetitionEntryRoster(entry.status, revision.origin, season, now, majorAdjustmentPhaseOpen);
  const canRequestRosterChange = !rosterFrozen && entry?.status === "approved"
    && entry.hasApprovedRoster && majorAdjustmentPhaseOpen && canSelfChangeApprovedRoster(season, now);
  const selfChangeOpen = majorAdjustmentPhaseOpen && canSelfChangeApprovedRoster(season, now);
  const canWithdrawParticipation = Boolean(input.eliminatedParticipationRelease && entry) || !rosterFrozen && !!entry
    && (entry.status === "approved" ? entry.hasApprovedRoster && selfChangeOpen
      : revision?.origin === "self_roster_change" ? selfChangeOpen : majorAdjustmentPhaseOpen);
  const canWithdrawFromReview = !rosterFrozen && entry?.status === "submitted"
    && revision?.status === "submitted" && window.canSubmit;
  const rosterChangeClosed = !canSelfChangeApprovedRoster(season, now);
  return {
    canStartRegistration: !entry && window.canSubmit,
    canEditCurrentRoster: editable,
    canSubmitForReview: editable,
    canWithdrawFromReview,
    canWithdrawParticipation,
    ...(input.eliminatedParticipationRelease && entry ? { canReleaseEliminatedParticipation: true } : {}),
    canRequestRosterChange,
    canConfirmParticipation: editable,
    canRespondToAdminRemediation: editable && revision?.origin === "admin_remediation",
    readOnlyReason: input.eliminatedParticipationRelease && entry ? null : rosterFrozen ? "最终名单已锁定；如需处理名单或参赛状态，请联系赛事管理员。" : editable || canRequestRosterChange ? null
      : entry?.status === "approved" || (entry?.status === "changes_requested" && revision?.origin === "self_roster_change")
        ? rosterChangeClosed ? "名单调整已截止；如需处理名单或参赛状态，请联系赛事管理员。" : !majorAdjustmentPhaseOpen ? "当前赛事阶段暂不开放名单调整；最终名单确认后，符合条件的队伍可在截止前调整。" : "当前名单暂不可自行调整，请联系赛委会。"
        : window.canSubmit ? null : window.message,
  };
}

export type CompetitionEntryCapabilities = ReturnType<typeof getCompetitionEntryCapabilities>;

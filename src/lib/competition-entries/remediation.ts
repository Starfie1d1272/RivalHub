import { canSelfManageEventRoster, getRegistrationWindowState, type RegistrationWindowSeason } from "@/lib/registration/window";

export type CompetitionEntryEditableStatus = "draft" | "changes_requested";
export type CompetitionEntryRosterRevisionOrigin = "initial" | "admin_remediation" | "self_roster_change";

/**
 * The revision origin, rather than mutable review text, distinguishes ordinary
 * registration, an administrator-requested remediation, and a self-service
 * approved-roster change. Every roster mutation consumes this one policy.
 */
export function canMutateCompetitionEntryRoster(
  status: CompetitionEntryEditableStatus,
  origin: CompetitionEntryRosterRevisionOrigin,
  season: RegistrationWindowSeason,
  now = new Date(),
): boolean {
  if (status === "draft") return getRegistrationWindowState(season, now).canSubmit;
  if (origin === "admin_remediation") return true;
  return origin === "self_roster_change" && canSelfManageEventRoster(season, now);
}

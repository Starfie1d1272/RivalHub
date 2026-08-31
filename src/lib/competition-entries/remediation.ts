export type CompetitionEntryEditableStatus = "draft" | "changes_requested";

/**
 * A normal registration deadline closes ordinary editing. An administrator's
 * `changes_requested` decision is the one narrow exception: the representative
 * may repair the current revision and resubmit it, but cannot create a new
 * registration or request an unrelated post-approval roster change.
 */
export function canEditCompetitionEntryRoster(
  status: CompetitionEntryEditableStatus,
  canSubmit: boolean,
): boolean {
  return canSubmit || status === "changes_requested";
}

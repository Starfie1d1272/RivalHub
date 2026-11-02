import type { CompetitionEntryRegistrationStatus } from "./presentation";

/** Read-only interpretation of the legacy entry status and the two revision pointers. */
export function interpretEntryRosterStatus(input: {
  registrationStatus: CompetitionEntryRegistrationStatus;
  currentRosterRevisionId: string | null;
  approvedRosterRevisionId: string | null;
  revisionStatus: "draft" | "submitted" | "approved" | "superseded" | null;
}) {
  const hasApprovedRoster = input.approvedRosterRevisionId !== null;
  const hasDifferentCurrentRoster = hasApprovedRoster && input.currentRosterRevisionId !== input.approvedRosterRevisionId;
  return {
    hasApprovedRoster,
    currentRosterReview: hasDifferentCurrentRoster ? { revisionStatus: input.revisionStatus, decision: input.registrationStatus } : null,
  } as const;
}

import type { QualificationFinding } from "@/lib/qualification/finding";
import type { TeamRegistrationReviewRow } from "./admin-review-contract";

export type TeamRegistrationSummaryState = "ready" | "pending";

export interface TeamRegistrationSummaryItem {
  label: string;
  value: string;
  state: TeamRegistrationSummaryState;
}

function findingKey(finding: Pick<QualificationFinding, "code" | "message">): string {
  return `${finding.code}\u0000${finding.message}`;
}

/**
 * Qualification findings that are already represented by a member's own
 * readiness detail stay with that member. Team-level findings and override
 * decisions remain in the qualification/exception presentation.
 */
export function presentTeamQualificationFindings(
  entry: Pick<TeamRegistrationReviewRow, "qualificationFindings" | "members">,
): QualificationFinding[] {
  const memberFindingKeys = new Set(
    entry.members.flatMap((member) => [
      ...(member.readiness?.findings ?? []).map(findingKey),
      ...(member.readiness?.blockers ?? []).map((message) => `message\u0000${message}`),
    ]),
  );

  return entry.qualificationFindings.filter((finding) =>
    finding.waivable || (!memberFindingKeys.has(findingKey(finding)) && !memberFindingKeys.has(`message\u0000${finding.message}`)),
  );
}

export function presentTeamRegistrationSummary(
  entry: Pick<TeamRegistrationReviewRow, "members" | "minRoster" | "maxRoster" | "starterCount" | "qualificationFindings" | "activeRestrictionOverrides">,
): TeamRegistrationSummaryItem[] {
  const confirmed = entry.members.filter((member) => member.status === "confirmed").length;
  const starters = entry.members.filter((member) => member.primary).length;
  const rosterReady = entry.members.length >= entry.minRoster && entry.members.length <= entry.maxRoster;
  const confirmationsReady = entry.members.length > 0 && confirmed === entry.members.length;
  const startersReady = starters === entry.starterCount;
  const qualificationReady = entry.qualificationFindings.every((finding) =>
    finding.waivable && entry.activeRestrictionOverrides.some((override) =>
      override.restrictionCode === finding.code && override.snapshotMatches,
    ),
  );

  return [
    { label: "名单", value: `${entry.members.length}/${entry.minRoster}–${entry.maxRoster}`, state: rosterReady ? "ready" : "pending" },
    { label: "已确认", value: `${confirmed}/${entry.members.length}`, state: confirmationsReady ? "ready" : "pending" },
    { label: "主力", value: `${starters}/${entry.starterCount}`, state: startersReady ? "ready" : "pending" },
    { label: "资格", value: qualificationReady ? "已通过" : "待处理", state: qualificationReady ? "ready" : "pending" },
  ];
}

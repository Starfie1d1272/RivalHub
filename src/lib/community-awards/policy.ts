import type { CommunityAward } from "@/db/schema/community-awards";

export type CommunityAwardOutcome = "awarded" | "not_awarded" | "cancelled";
type SettlementPolicy = Pick<CommunityAward, "settlementPolicy" | "settlementStageKey">;
type Progress = { seasonComplete: boolean; playInComplete: boolean; completedStageKeys: readonly string[] };

/** Shared by the result owner and its admin projection; candidates never imply finality. */
export function canSettleCommunityAward(policy: SettlementPolicy, progress: Progress, status: CommunityAwardOutcome, recipients: readonly string[], eligibleCandidateIds: readonly string[]): boolean {
  // Cancellation removes a prize/result, so remains available for reasoned operational correction.
  if (status === "cancelled") return true;
  switch (policy.settlementPolicy) {
    case "season_complete": return progress.seasonComplete;
    case "play_in_complete": return progress.playInComplete;
    case "stage_complete": return progress.completedStageKeys.includes(policy.settlementStageKey ?? "");
    case "event_verified": return status === "not_awarded" ? progress.seasonComplete : recipients.length > 0 && recipients.every(id => eligibleCandidateIds.includes(id));
  }
}

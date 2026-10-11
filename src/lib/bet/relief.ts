/** No clock or persistence: both the read model and locked claim use this policy. */
export const BET_RELIEF_POLICY = { target: BigInt(10), seasonLimit: BigInt(100) } as const;
export type BetReliefReason = "publication_unavailable" | "eligible" | "login_required" | "account_invalid" | "disabled" | "paused" | "season_closed" | "join_required" | "debt" | "claimed_today" | "limit_reached" | "balance_sufficient";
export interface BetReliefDTO {
  day: string;
  reason: BetReliefReason;
  canClaim: boolean;
  amount: string;
  granted: string;
  remaining: string;
}
export interface BetReliefFacts {
  day: string; loggedIn: boolean; activeVerified: boolean; enabled: boolean; paused: boolean;
  seasonOpen: boolean; joined: boolean; balance: bigint; granted: bigint; claimedToday: boolean;
}
export function projectBetRelief(f: BetReliefFacts): BetReliefDTO {
  const remaining = f.granted < BET_RELIEF_POLICY.seasonLimit ? BET_RELIEF_POLICY.seasonLimit - f.granted : BigInt(0);
  const reason: BetReliefReason = !f.loggedIn ? "login_required" : !f.activeVerified ? "account_invalid"
    : !f.enabled ? "disabled" : !f.seasonOpen ? "season_closed" : f.paused ? "paused"
    : !f.joined ? "join_required" : f.balance < BigInt(0) ? "debt" : f.claimedToday ? "claimed_today"
    : remaining === BigInt(0) ? "limit_reached" : f.balance >= BET_RELIEF_POLICY.target ? "balance_sufficient" : "eligible";
  const gap = reason === "eligible" ? BET_RELIEF_POLICY.target - f.balance : BigInt(0);
  return { day: f.day, reason, canClaim: reason === "eligible", amount: (gap < remaining ? gap : remaining).toString(), granted: f.granted.toString(), remaining: remaining.toString() };
}
export interface BetReliefClaimDTO {
  day: string; amount: string; replayed: boolean; eligibility: BetReliefDTO;
}

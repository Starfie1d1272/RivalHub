/** Fixed product policy. Points have no real-world value; no Pick’Em rewards. */
export const BET_POLICY = { initialPoints: BigInt(1000), stagePoints: BigInt(300), minimumRoundSamples: 3, fallbackRoundLineTwice: 43 } as const;
/** Half-round median line, frozen at creation. Recent team/map samples precede event history. */
export function roundLineTwice(recent: readonly number[], history: readonly number[]): number {
  const samples = recent.length >= BET_POLICY.minimumRoundSamples ? recent : history;
  if (samples.length < BET_POLICY.minimumRoundSamples) return BET_POLICY.fallbackRoundLineTwice;
  const sorted = [...samples].sort((a,b)=>a-b);
  const middle = sorted[Math.floor(sorted.length / 2)]!;
  return Math.max(25, Math.min(71, middle * 2 - 1));
}
export function seriesLineTwice(format: "bo3" | "bo5"): number { return format === "bo3" ? 5 : 7; }

import type { TournamentPerformancePlayerSlice } from "@cs2dak/tournament";

/** Narrow missing display ratios over canonical cumulative facts. */
export function openingDeathTraded(slice: TournamentPerformancePlayerSlice) {
  const successes = slice.trade.tradedOpeningDeaths;
  const attempts = slice.opening.firstDeaths;
  return { successes, attempts, rate: attempts > 0 ? successes / attempts : null };
}
export function friendlyBlindPerFlash(slice: TournamentPerformancePlayerSlice) {
  const successes = slice.utility.teamBlindSeconds;
  const attempts = slice.utility.flashesThrown;
  return { successes, attempts, rate: attempts > 0 ? successes / attempts : null };
}

import { expect, it } from "vitest";
import { playerStatsAvailable } from "./stats-scope";

it("checks only the selected player's complete Rating and ADR coverage", () => {
  const complete = { maps: 2, ratingSamples: 2, rounds: 40, adrRounds: 40, avgRating: 1.1, avgAdr: 0 };
  expect(playerStatsAvailable(complete)).toBe(true);
  expect(playerStatsAvailable({ ...complete, adrRounds: 20 })).toBe(false);
  expect(playerStatsAvailable({ ...complete, avgRating: null })).toBe(false);
  expect(playerStatsAvailable(undefined)).toBe(false);
});

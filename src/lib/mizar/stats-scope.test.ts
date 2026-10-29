import { expect, it } from "vitest";
import { playerStatsAvailable } from "./stats-scope";

it("qualifies Rating independently of ADR coverage", () => {
  const row = { ratingSamples: 1, avgRating: 1.1, avgAdr: null };
  expect(playerStatsAvailable(row)).toBe(true);
  expect(playerStatsAvailable({ ...row, avgRating: 0 })).toBe(true);
  expect(playerStatsAvailable({ ...row, ratingSamples: 0 })).toBe(false);
  expect(playerStatsAvailable({ ...row, avgRating: null })).toBe(false);
  expect(playerStatsAvailable({ ...row, avgRating: NaN })).toBe(false);
  expect(playerStatsAvailable(undefined)).toBe(false);
});

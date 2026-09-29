import { describe, expect, it } from "vitest";
import { canConfirmMapScoreboard } from "./map-scoreboard";

describe("map scoreboard gate", () => {
  it("allows official map scores regardless of the series lifecycle", () => {
    expect(canConfirmMapScoreboard({ scoreA: 16, scoreB: 14 })).toBe(true);
    expect(canConfirmMapScoreboard({ scoreA: 13, scoreB: 9 })).toBe(true);
  });

  it("rejects current or incomplete maps while keeping an already completed map confirmable after forfeit", () => {
    expect(canConfirmMapScoreboard({ scoreA: null, scoreB: null })).toBe(false);
    expect(canConfirmMapScoreboard({ scoreA: 13, scoreB: null })).toBe(false);
    // A later series forfeit does not erase the official result of an earlier played map.
    expect(canConfirmMapScoreboard({ scoreA: 13, scoreB: 9 })).toBe(true);
  });
});

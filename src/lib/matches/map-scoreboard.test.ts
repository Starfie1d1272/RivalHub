import { describe, expect, it } from "vitest";
import { canConfirmMapScoreboard } from "./map-scoreboard";

const completedAt = new Date("2026-09-29T00:00:00.000Z");

describe("map scoreboard gate", () => {
  it("allows completed official map scores regardless of the later series lifecycle", () => {
    expect(canConfirmMapScoreboard({ scoreA: 16, scoreB: 14, completedAt })).toBe(true);
    expect(canConfirmMapScoreboard({ scoreA: 13, scoreB: 9, completedAt })).toBe(true);
  });

  it("rejects maps without either a complete score pair or the canonical completion fact", () => {
    expect(canConfirmMapScoreboard({ scoreA: null, scoreB: null, completedAt: null })).toBe(false);
    expect(canConfirmMapScoreboard({ scoreA: 13, scoreB: null, completedAt })).toBe(false);
    expect(canConfirmMapScoreboard({ scoreA: 13, scoreB: 9, completedAt: null })).toBe(false);
  });

  it("keeps an already completed map confirmable after the series later ends by forfeit or cancellation", () => {
    expect(canConfirmMapScoreboard({ scoreA: 13, scoreB: 9, completedAt })).toBe(true);
  });
});

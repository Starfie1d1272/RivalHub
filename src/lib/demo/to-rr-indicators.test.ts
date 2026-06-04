import { describe, expect, it } from "vitest";
import { toRRIndicators } from "./to-rr-indicators";

describe("toRRIndicators", () => {
  it("keeps unavailable v2 context fields null for the legacy DB adapter", () => {
    const result = toRRIndicators({
      steamId64: "76561198000000000",
      stats: [],
      totalRoundsOverride: 12,
    });

    expect(result).toMatchObject({
      enemyFlashDurationSeconds: null,
      enemyFlashDurationPerRound: null,
      teamFlashDurationSeconds: null,
      teamFlashDurationPerRound: null,
      combatDeathCount: null,
      bombDeathCount: null,
      wallbangKillCount: null,
    });
  });
});

import { describe, expect, it } from "vitest";
import { STATS_METRICS } from "./metrics";

describe("stats metric naming contract", () => {
  it("keeps standard acronyms and lowercase explicit round denominators", () => {
    expect(STATS_METRICS.kpr.label).toBe("KPR");
    expect(STATS_METRICS.firstKill.label).toBe("FK/100r");
    expect(STATS_METRICS.flashAssist.label).toBe("FA/100r");
    expect(STATS_METRICS.trade.label).toBe("Trade/r");
    expect(STATS_METRICS.utility.label).toBe("Util/r");
    expect(STATS_METRICS.hePerRound.label).toBe("HE/r");
  });

  it("uses concise contextual rate names for opening and round outcomes", () => {
    expect(STATS_METRICS.openingAttempt.label).toBe("Attempts%");
    expect(STATS_METRICS.openingWin.label).toBe("Success%");
    expect(STATS_METRICS.pistol.label).toBe("Pistol Win%");
    expect(STATS_METRICS.ecoSemi.label).toBe("Eco/Semi Win%");
  });
});

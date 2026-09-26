import { describe, expect, it } from "vitest";
import {
  deriveCompetitionQualificationPlan,
  isShortSwissQualificationAllowed,
  orderQualificationCandidates,
  SHORT_SWISS_DISABLED_NOTE,
  swapQualificationPreliminaryRank,
} from "./policy";

describe("competition qualification policy", () => {
  it("derives direct and play-in counts from all approved candidates", () => {
    expect(deriveCompetitionQualificationPlan(40, 32)).toEqual({
      targetEntrantCount: 32,
      candidateCount: 40,
      directEntryCount: 24,
      playInEntryCount: 16,
      qualifierCount: 8,
    });
    expect(deriveCompetitionQualificationPlan(30, 24)).toEqual({
      targetEntrantCount: 24,
      candidateCount: 30,
      directEntryCount: 18,
      playInEntryCount: 12,
      qualifierCount: 6,
    });
  });

  it("rejects over-capacity inputs that cannot converge in one layer", () => {
    expect(() => deriveCompetitionQualificationPlan(65, 32)).toThrow(
      "当前报名规模无法通过单层 Play-in 收敛到目标正赛规模。",
    );
  });

  it("enables short Swiss only for at least four entrants in groups of four", () => {
    expect(isShortSwissQualificationAllowed(2)).toBe(false);
    expect(isShortSwissQualificationAllowed(4)).toBe(true);
    expect(isShortSwissQualificationAllowed(8)).toBe(true);
    expect(isShortSwissQualificationAllowed(12)).toBe(true);
    expect(isShortSwissQualificationAllowed(6)).toBe(false);
    expect(SHORT_SWISS_DISABLED_NOTE).toBe("Short Swiss 需要 Play-in 队伍数为 4 的倍数。");
  });

  it("uses current strength display order and stable name/id order for unranked teams", () => {
    const ordered = orderQualificationCandidates([
      { entryId: "z", teamName: "海", displayOrder: null },
      { entryId: "b", teamName: "山", displayOrder: 2 },
      { entryId: "a", teamName: "山", displayOrder: null },
      { entryId: "c", teamName: "海", displayOrder: 1 },
    ]);
    expect(ordered.map((entry) => entry.entryId)).toEqual(["c", "b", "z", "a"]);
  });

  it("swaps a selected candidate with the occupied preliminary rank", () => {
    expect(swapQualificationPreliminaryRank(["a", "b", "c"], "a", 3)).toEqual(["c", "b", "a"]);
  });
});

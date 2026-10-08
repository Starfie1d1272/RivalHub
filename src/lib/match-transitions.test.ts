import { describe, it, expect } from "vitest";
import { assertMatchTransition, resolveMatchFormat, type MatchStatus } from "@/lib/match-transitions";
import { AppError, ErrorCode } from "@/lib/errors";
import type { StagePlan } from "@/types/season";

describe("assertMatchTransition", () => {
  const allowed: Array<[MatchStatus, MatchStatus]> = [
    ["scheduled", "in_progress"], ["scheduled", "cancelled"], ["scheduled", "finished"],
    ["in_progress", "finished"], ["in_progress", "cancelled"],
  ];

  it("allows the declared lifecycle transitions through the executable guard", () => {
    for (const [from, to] of allowed) expect(() => assertMatchTransition(from, to)).not.toThrow();
  });

  const statuses: MatchStatus[] = ["scheduled", "in_progress", "finished", "cancelled"];
  const forbidden = statuses.flatMap(from => statuses.map(to => [from, to] as [MatchStatus, MatchStatus]))
    .filter(([from, to]) => !allowed.some(([a, b]) => a === from && b === to));
  it.each(forbidden)("rejects %s → %s with the domain error", (from, to) => {
    expect(() => assertMatchTransition(from, to)).toThrow(AppError);
    expect(() => assertMatchTransition(from, to)).toThrow(expect.objectContaining({ code: ErrorCode.MATCH_INVALID_TRANSITION }));
  });
});

describe("resolveMatchFormat", () => {
  const basePlan: StagePlan = [
    {
      key: "qualifier",
      name: "排位赛",
      type: "round_robin",
      teamCount: 8,
      advanceTiers: [{ placement: "*", count: 8 }],
      matchFormat: "bo1",
    },
    {
      key: "playoff",
      name: "淘汰赛",
      type: "double_elim",
      teamCount: 8,
      advanceTiers: [{ placement: "1st", count: 1 }],
      matchFormat: "bo3",
      finalFormat: "bo5",
    },
  ];

  it("returns stage matchFormat for non-final rounds", () => {
    expect(resolveMatchFormat(basePlan, "qualifier", 1)).toBe("bo1");
    expect(resolveMatchFormat(basePlan, "playoff", 1, 1)).toBe("bo3");
  });

  describe("double_elim: finalFormat 只作用于总决赛", () => {
    // 8 队胜者组共 3 轮，胜者组决赛轮号 === log2(8)，但它不是决赛
    it("胜者组决赛（winner bracket, group 1）不套用 finalFormat", () => {
      expect(resolveMatchFormat(basePlan, "playoff", 3, 1)).toBe("bo3");
    });

    it("败者组决赛（loser bracket, group 2）不套用 finalFormat", () => {
      expect(resolveMatchFormat(basePlan, "playoff", 4, 2)).toBe("bo3");
    });

    it("总决赛（grand final, group 3）套用 finalFormat", () => {
      expect(resolveMatchFormat(basePlan, "playoff", 1, 3)).toBe("bo5");
    });

    it("总决赛 bracket reset（仍在 group 3）套用 finalFormat", () => {
      expect(resolveMatchFormat(basePlan, "playoff", 2, 3)).toBe("bo5");
    });
  });

  describe("single_elim: finalFormat 作用于最后一轮", () => {
    const singlePlan: StagePlan = [
      {
        key: "bracket",
        name: "淘汰赛",
        type: "single_elim",
        teamCount: 8,
        advanceTiers: [{ placement: "1st", count: 1 }],
        matchFormat: "bo3",
        finalFormat: "bo5",
      },
    ];

    it("非最后一轮用 matchFormat", () => {
      expect(resolveMatchFormat(singlePlan, "bracket", 1, 1)).toBe("bo3");
      expect(resolveMatchFormat(singlePlan, "bracket", 2, 1)).toBe("bo3");
    });

    it("最后一轮（决赛）用 finalFormat", () => {
      expect(resolveMatchFormat(singlePlan, "bracket", 3, 1)).toBe("bo5");
    });
  });

  it("defaults to bo3 for unknown stage", () => {
    expect(resolveMatchFormat(basePlan, "unknown", 1)).toBe("bo3");
  });
});

describe("single elimination configuration boundaries", () => {
  it("rounds six entrants up to an eight-slot bracket before applying the final format", () => {
    const plan = [{ key: "playoff", matchFormat: "bo3", teamCount: 6, type: "single_elim", finalFormat: "bo5" }] as StagePlan;
    expect(resolveMatchFormat(plan, "playoff", 2)).toBe("bo3");
    expect(resolveMatchFormat(plan, "playoff", 3)).toBe("bo5");
  });
  it("keeps the stage format when no final override is declared", () => {
    const plan = [{ key: "playoff", matchFormat: "bo3", teamCount: 8, type: "single_elim" }] as StagePlan;
    expect(resolveMatchFormat(plan, "playoff", 3)).toBe("bo3");
  });
});

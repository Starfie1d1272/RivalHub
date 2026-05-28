import { describe, it, expect } from "vitest";
import { assertMatchTransition, resolveMatchFormat } from "@/lib/match-transitions";
import { AppError, ErrorCode } from "@/lib/errors";
import type { StageConfig, StagePlan } from "@/types/season";

describe("assertMatchTransition", () => {
  it("allows scheduled → in_progress", () => {
    expect(() => assertMatchTransition("scheduled", "in_progress")).not.toThrow();
  });

  it("allows scheduled → cancelled", () => {
    expect(() => assertMatchTransition("scheduled", "cancelled")).not.toThrow();
  });

  it("allows in_progress → finished", () => {
    expect(() => assertMatchTransition("in_progress", "finished")).not.toThrow();
  });

  it("allows in_progress → cancelled", () => {
    expect(() => assertMatchTransition("in_progress", "cancelled")).not.toThrow();
  });

  it("rejects finished → in_progress", () => {
    expect(() => assertMatchTransition("finished", "in_progress")).toThrow(AppError);
  });

  it("rejects finished → scheduled", () => {
    expect(() => assertMatchTransition("finished", "scheduled")).toThrow(AppError);
  });

  it("rejects cancelled → anything", () => {
    expect(() => assertMatchTransition("cancelled", "scheduled")).toThrow(AppError);
    expect(() => assertMatchTransition("cancelled", "in_progress")).toThrow(AppError);
    expect(() => assertMatchTransition("cancelled", "finished")).toThrow(AppError);
  });

  it("allows scheduled → finished (forfeit)", () => {
    expect(() => assertMatchTransition("scheduled", "finished")).not.toThrow();
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

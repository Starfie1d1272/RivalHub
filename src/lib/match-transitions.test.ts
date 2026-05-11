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

  it("rejects scheduled → finished (no playing)", () => {
    expect(() => assertMatchTransition("scheduled", "finished")).toThrow(AppError);
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
    expect(resolveMatchFormat(basePlan, "playoff", 1)).toBe("bo3");
  });

  it("returns finalFormat for the last round", () => {
    // 8-team bracket = 3 rounds, round 3 should be finalFormat
    expect(resolveMatchFormat(basePlan, "playoff", 3)).toBe("bo5");
  });

  it("defaults to bo3 for unknown stage", () => {
    expect(resolveMatchFormat(basePlan, "unknown", 1)).toBe("bo3");
  });
});

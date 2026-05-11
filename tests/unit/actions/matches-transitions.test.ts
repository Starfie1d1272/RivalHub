import { describe, expect, it } from "vitest";
import {
  MATCH_TRANSITIONS,
  assertMatchTransition,
  resolveMatchFormat,
} from "@/lib/match-transitions";
import { AppError, ErrorCode } from "@/lib/errors";
import type { StagePlan } from "@/types/season";

describe("MATCH_TRANSITIONS", () => {
  it("scheduled→in_progress 合法", () => {
    expect(MATCH_TRANSITIONS["scheduled→in_progress"]).toBe(true);
  });

  it("scheduled→cancelled 合法", () => {
    expect(MATCH_TRANSITIONS["scheduled→cancelled"]).toBe(true);
  });

  it("in_progress→finished 合法", () => {
    expect(MATCH_TRANSITIONS["in_progress→finished"]).toBe(true);
  });

  it("in_progress→cancelled 合法", () => {
    expect(MATCH_TRANSITIONS["in_progress→cancelled"]).toBe(true);
  });

  it("finished→scheduled 不合法（不可逆）", () => {
    expect(MATCH_TRANSITIONS["finished→scheduled"]).toBeUndefined();
  });

  it("cancelled→scheduled 不合法", () => {
    expect(MATCH_TRANSITIONS["cancelled→scheduled"]).toBeUndefined();
  });

  it("scheduled→scheduled 不合法（无自身迁移）", () => {
    expect(MATCH_TRANSITIONS["scheduled→scheduled"]).toBeUndefined();
  });
});

describe("assertMatchTransition", () => {
  it("合法迁移不抛错", () => {
    expect(() =>
      assertMatchTransition("scheduled", "in_progress")
    ).not.toThrow();
    expect(() =>
      assertMatchTransition("scheduled", "cancelled")
    ).not.toThrow();
    expect(() =>
      assertMatchTransition("in_progress", "finished")
    ).not.toThrow();
    expect(() =>
      assertMatchTransition("in_progress", "cancelled")
    ).not.toThrow();
  });

  it("非法迁移抛 MATCH_INVALID_TRANSITION", () => {
    expect(() =>
      assertMatchTransition("finished", "scheduled")
    ).toThrow(AppError);
    try {
      assertMatchTransition("finished", "scheduled");
    } catch (e) {
      expect(e instanceof AppError).toBe(true);
      expect((e as AppError).code).toBe(ErrorCode.MATCH_INVALID_TRANSITION);
    }
  });

  it("cancelled→in_progress 抛错", () => {
    expect(() =>
      assertMatchTransition("cancelled", "in_progress")
    ).toThrow(AppError);
  });
});

describe("resolveMatchFormat", () => {
  const stagePlan = [
    { key: "swiss1", matchFormat: "bo1" as const, teamCount: 32, type: "swiss" as const },
    { key: "swiss2", matchFormat: "bo1" as const, teamCount: 16, type: "swiss" as const },
    { key: "playoff", matchFormat: "bo3" as const, teamCount: 16, type: "single_elim" as const, finalFormat: "bo5" as const },
  ] as StagePlan;

  it("非决赛轮次使用 stage 的 matchFormat", () => {
    // 16-team playoff: bracketSize=16, totalRounds=4
    // round 1-3 应该用 bo3
    expect(resolveMatchFormat(stagePlan, "playoff", 1)).toBe("bo3");
    expect(resolveMatchFormat(stagePlan, "playoff", 2)).toBe("bo3");
    expect(resolveMatchFormat(stagePlan, "playoff", 3)).toBe("bo3");
  });

  it("决赛轮次（round 4 = log2(16)）使用 finalFormat BO5", () => {
    expect(resolveMatchFormat(stagePlan, "playoff", 4)).toBe("bo5");
  });

  it("找不到 stage 配置时默认 bo3", () => {
    const r = resolveMatchFormat(stagePlan, "nonexistent", 1);
    expect(r).toBe("bo3");
  });

  it("没有 finalFormat 时使用 matchFormat", () => {
    const plan = [
      { key: "playoff", matchFormat: "bo3" as const, teamCount: 8, type: "single_elim" as const },
    ] as StagePlan;
    // 8 teams: bracketSize=8, totalRounds=3
    expect(resolveMatchFormat(plan, "playoff", 3)).toBe("bo3");
  });

  it("swiss stage 使用 bo1", () => {
    expect(resolveMatchFormat(stagePlan, "swiss1", 1)).toBe("bo1");
  });

  it("非 2 的幂队数（如 6 队）决赛轮正确识别", () => {
    const plan = [
      { key: "playoff", matchFormat: "bo3" as const, teamCount: 6, type: "single_elim" as const, finalFormat: "bo5" as const },
    ] as StagePlan;
    // 6 teams: bracketSize rounds up to 8, totalRounds=3
    expect(resolveMatchFormat(plan, "playoff", 1)).toBe("bo3");
    expect(resolveMatchFormat(plan, "playoff", 2)).toBe("bo3");
    expect(resolveMatchFormat(plan, "playoff", 3)).toBe("bo5");
  });
});

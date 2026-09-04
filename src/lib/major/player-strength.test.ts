import { describe, expect, it } from "vitest";
import type { CompetitiveProfileConfig } from "@/types/season";
import { createPerfectWorldRankOrder } from "@/lib/config/perfect-world";
import {
  comparePlayerStrength,
  evaluateExternalStrengthRule,
  getPlayerStrengthBreakdown,
  type PlayerStrengthInput,
} from "./player-strength";

const CONFIG: CompetitiveProfileConfig = {
  platform: "perfect_world",
  currentSeasonKey: "2026-current",
  previousSeasonKey: "2025-previous",
  rankOrder: createPerfectWorldRankOrder(),
};

function player(
  label: string,
  historical: string,
  previous: string,
  current: string,
  historicalRating = 1000,
  historicalStars: number | null = null,
): PlayerStrengthInput {
  return {
    userId: label,
    label,
    historicalPeak: { rank: historical, rating: historicalRating, stars: historicalStars },
    previousSeasonPeak: { rank: previous, rating: 900 },
    currentSeasonPeak: { rank: current, rating: 800 },
  };
}

describe("Major player strength comparator", () => {
  it.each([
    {
      name: "综合值不同",
      left: player("left", "青铜S", "A", "A"),
      right: player("right", "A", "A", "A"),
      order: 1,
      reason: "综合段位参考值",
    },
    {
      name: "综合值相同后比较历史最高",
      left: player("left", "青铜S", "B", "B"),
      right: player("right", "A", "A", "A"),
      order: 1,
      reason: "历史最高段位",
    },
    {
      name: "综合值和历史相同后比较当前赛季",
      left: player("left", "A", "C", "青铜S"),
      right: player("right", "A", "青铜S", "B"),
      order: 1,
      reason: "当前赛季最高段位",
    },
    {
      name: "综合值完全相同后比较历史 Rating",
      left: player("left", "A", "A", "A", 1100),
      right: player("right", "A", "A", "A", 1000),
      order: 1,
      reason: "历史最高段位对应 Rating",
    },
  ])("$name", ({ left, right, order, reason }) => {
    const result = comparePlayerStrength(left, right, CONFIG);
    expect(result.order).toBe(order);
    expect(result.reason).toContain(reason);
  });

  it("returns equal when every configured comparison item is equal", () => {
    const result = comparePlayerStrength(
      player("left", "A", "A", "A", 1000),
      player("right", "A", "A", "A", 1000),
      CONFIG,
    );
    expect(result.order).toBe(0);
    expect(result.reason).toContain("实力相当");
  });

  it("fails closed for missing facts, unknown ranks, and incomplete season configuration", () => {
    const missing = player("missing", "A", "A", "A");
    missing.currentSeasonPeak = null;
    expect(getPlayerStrengthBreakdown(missing, CONFIG).available).toBe(false);
    expect(comparePlayerStrength(missing, player("other", "魔王S", "魔王S", "魔王S"), CONFIG).order).toBe(0);

    expect(getPlayerStrengthBreakdown(player("unknown", "X", "A", "A"), CONFIG).blockers).toContain(
      "申报段位不在本赛事公布的段位映射中。",
    );
    expect(getPlayerStrengthBreakdown(player("unconfigured", "A", "A", "A"), {
      ...CONFIG,
      currentSeasonKey: "",
      previousSeasonKey: "",
      rankOrder: [],
    }).available).toBe(false);
  });

  it("uses the configured season rank order without converting an unspecified platform", () => {
    const high = getPlayerStrengthBreakdown(player("high", "魔王S", "魔王S", "魔王S"), CONFIG);
    const low = getPlayerStrengthBreakdown(player("low", "C", "C", "C"), CONFIG);
    expect(high.weightedRank).toBe(14);
    expect(low.weightedRank).toBe(2);
    expect(getPlayerStrengthBreakdown(player("fivee", "5E", "5E", "5E"), CONFIG).available).toBe(false);
  });

  it("uses the strongest declared recent season instead of penalizing an ongoing reset", () => {
    const policyConfig: CompetitiveProfileConfig = {
      ...CONFIG,
      evidencePolicy: {
        historicalWeight: 50,
        referenceSeasonKey: "2024-complete",
        referenceSeasonWeight: 20,
        recentSeasonKeys: ["2025-complete", "2026-ongoing"],
        recentSeasonWeight: 30,
      },
    };
    const playerWithReset = {
      ...player("reset", "A", "A", "C"),
      recentSeasonPeaks: [{ rank: "魔王S", rating: 1200 }, { rank: "C", rating: 800 }],
    };
    const breakdown = getPlayerStrengthBreakdown(playerWithReset, policyConfig);
    expect(breakdown.available).toBe(true);
    expect(breakdown.currentValue).toBe(CONFIG.rankOrder.indexOf("魔王S") + 1);
  });
});

describe("Major external-member strength rule", () => {
  const home = player("nju-strongest", "钻石S", "A", "A", 1000, 35);

  it("allows an all-NJU lineup", () => {
    expect(evaluateExternalStrengthRule({ config: CONFIG, players: [home, player("nju-weaker", "黄金S", "A", "A", 1000, 10)].map((item) => ({ ...item, isHome: true })) })).toEqual({ eligible: true, blockers: [], findings: [] });
  });

  it("allows an external within 3 stars of the strongest NJU member", () => {
    const result = evaluateExternalStrengthRule({
      config: CONFIG,
      players: [
        { ...home, isHome: true },
        { ...player("external-38", "钻石S", "A", "A", 1000, 38), isHome: false },
      ],
    });
    expect(result.eligible).toBe(true);
  });

  it("blocks an external more than 3 stars above the strongest NJU member", () => {
    const result = evaluateExternalStrengthRule({
      config: CONFIG,
      players: [
        { ...home, isHome: true },
        { ...player("external-39", "钻石S", "A", "A", 1000, 39), isHome: false },
      ],
    });
    expect(result.eligible).toBe(false);
    expect(result.blockers.join(" ")).toContain("external-39");
    expect(result.blockers.join(" ")).toContain("nju-strongest");
    expect(result.findings).toMatchObject([{ code: "external_strength_gap", waivable: true }]);
  });

  it("allows an external with no S stars (below-S rank)", () => {
    const result = evaluateExternalStrengthRule({
      config: CONFIG,
      players: [
        { ...home, isHome: true },
        { ...player("external-a", "A++", "A", "A"), isHome: false },
      ],
    });
    expect(result.eligible).toBe(true);
  });

  it("blocks when the NJU baseline has no S stars but an external does", () => {
    const result = evaluateExternalStrengthRule({
      config: CONFIG,
      players: [
        { ...player("nju-a", "A++", "A", "A"), isHome: true },
        { ...player("external-30", "钻石S", "A", "A", 1000, 30), isHome: false },
      ],
    });
    expect(result.eligible).toBe(false);
    expect(result.blockers.join(" ")).toContain("本校成员均无 S 段位星数");
    expect(result.findings).toMatchObject([{ code: "external_strength_gap", waivable: true }]);
  });

  it("blocks when any of multiple external members violates the rule", () => {
    const result = evaluateExternalStrengthRule({
      config: CONFIG,
      players: [
        { ...home, isHome: true },
        { ...player("external-ok", "黄金S", "A", "A", 1000, 20), isHome: false },
        { ...player("external-bad", "钻石S", "A", "A", 1000, 45), isHome: false },
      ],
    });
    expect(result.eligible).toBe(false);
    expect(result.blockers.join(" ")).toContain("external-bad");
    expect(result.blockers.join(" ")).not.toContain("external-ok");
  });

  it("does not silently compare when there is no NJU reference or required stars are missing", () => {
    expect(evaluateExternalStrengthRule({ config: CONFIG, players: [{ ...home, isHome: false }] }).blockers[0]).toContain("没有可确认的南京大学成员");

    // S 段位缺少准确星数 → 资料未完成，直接阻止提交。
    const insufficient = player("external-no-stars", "钻石S", "A", "A");
    const result = evaluateExternalStrengthRule({
      config: CONFIG,
      players: [
        { ...home, isHome: true },
        { ...insufficient, isHome: false },
      ],
    });
    expect(result.eligible).toBe(false);
    expect(result.blockers.join(" ")).toContain("缺少准确星数");
    expect(result.blockers.join(" ")).not.toContain("人工审核");
    expect(result.findings).toMatchObject([{ code: "competitive_profile_incomplete", waivable: false }]);
  });
});

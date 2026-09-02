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
): PlayerStrengthInput {
  return {
    userId: label,
    label,
    historicalPeak: { rank: historical, rating: historicalRating },
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
  const home = player("nju-strongest", "青铜S", "A", "A");
  const weakerHome = player("nju-weaker", "A", "A", "A");

  it("allows an all-NJU lineup", () => {
    expect(evaluateExternalStrengthRule({ config: CONFIG, players: [home, weakerHome].map((item) => ({ ...item, isHome: true })) })).toEqual({ eligible: true, blockers: [] });
  });

  it.each([
    { label: "external-equal", fact: player("external-equal", "A", "A", "A"), eligible: true },
    { label: "external-weaker", fact: player("external-weaker", "A", "B", "A"), eligible: true },
    { label: "external-stronger", fact: player("external-stronger", "魔王S", "魔王S", "魔王S"), eligible: false },
  ])("handles $label against the strongest NJU reference", ({ fact, eligible, label }) => {
    const result = evaluateExternalStrengthRule({
      config: CONFIG,
      players: [
        { ...weakerHome, isHome: true },
        { ...fact, isHome: false },
      ],
    });
    expect(result.eligible).toBe(eligible);
    if (!eligible) {
      expect(result.blockers[0]).toContain(label);
      expect(result.blockers[0]).toContain("nju-weaker");
      expect(result.blockers[0]).toContain("综合段位参考值");
    }
  });

  it("blocks when any of multiple external members violates the rule", () => {
    const result = evaluateExternalStrengthRule({
      config: CONFIG,
      players: [
        { ...home, isHome: true },
        { ...player("external-ok", "A", "A", "A"), isHome: false },
        { ...player("external-bad", "魔王S", "魔王S", "魔王S"), isHome: false },
      ],
    });
    expect(result.eligible).toBe(false);
    expect(result.blockers.join(" ")).toContain("external-bad");
    expect(result.blockers.join(" ")).toContain("nju-strongest");
    expect(result.blockers.join(" ")).not.toContain("external-ok");
  });

  it("does not silently compare when there is no NJU reference or facts are missing", () => {
    expect(evaluateExternalStrengthRule({ config: CONFIG, players: [{ ...home, isHome: false }] }).blockers[0]).toContain("没有可确认的南京大学成员");
    const missing = player("external-missing", "A", "A", "A");
    missing.currentSeasonPeak = null;
    const result = evaluateExternalStrengthRule({ config: CONFIG, players: [{ ...home, isHome: true }, { ...missing, isHome: false }] });
    expect(result.eligible).toBe(false);
    expect(result.blockers.join(" ")).toContain("external-missing");
    expect(result.blockers.join(" ")).toContain("资料不可确认");
  });
});

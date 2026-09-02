import { describe, expect, it } from "vitest";
import { presentCompetitiveRole, presentPublicCompetitiveProfile, presentPublicCompetitiveSummary } from "@/lib/competitive/presentation";

const catalog = [{
  key: "perfect_world",
  displayName: "完美平台",
  ratingLabel: "Rating Pro",
  ranks: [
    { id: "bronze", rankKey: "bronze_s", label: "青铜 S", sortOrder: 1, starMin: 0, starMax: 9 },
    { id: "gold", rankKey: "gold_s", label: "黄金 S", sortOrder: 2, starMin: 10, starMax: 24 },
  ],
  seasons: [
    { id: "s1", seasonKey: "2026s1", label: "2026 第一赛季", sortOrder: 202601, active: true, isCurrent: false },
    { id: "s2", seasonKey: "2026s2", label: "2026 第二赛季", sortOrder: 202602, active: true, isCurrent: true },
  ],
}];

describe("public competitive profile presentation", () => {
  it("keeps only historical and current facts in the compact summary", () => {
    const summary = presentPublicCompetitiveSummary(catalog, [
      { id: "history", platform: "perfect_world", kind: "historical_peak", platformSeasonKey: null, rank: "gold_s", rating: "1.17", stars: 10, achievedSeasonKey: "2026s1" },
      { id: "current", platform: "perfect_world", kind: "season_peak", platformSeasonKey: "2026s2", rank: "gold_s", rating: "1.17", stars: 10 },
    ]);

    expect(summary).toEqual([{
      displayName: "完美平台",
      facts: [
        { label: "历史最高 · 2026 第一赛季", rankLabel: "黄金 S", stars: 10, ratingLabel: "Rating Pro", rating: "1.17" },
        { label: "2026 第二赛季 · 最高", rankLabel: "黄金 S", stars: 10, ratingLabel: "Rating Pro", rating: "1.17" },
      ],
    }]);
  });

  it("does not include an older season when the current season fact exists", () => {
    const summary = presentPublicCompetitiveSummary(catalog, [
      { id: "history", platform: "perfect_world", kind: "historical_peak", platformSeasonKey: null, rank: "gold_s", rating: "1.17", stars: 10 },
      { id: "previous", platform: "perfect_world", kind: "season_peak", platformSeasonKey: "2026s1", rank: "bronze_s", rating: "1.10", stars: 8 },
      { id: "current", platform: "perfect_world", kind: "season_peak", platformSeasonKey: "2026s2", rank: "gold_s", rating: "1.17", stars: 10 },
    ]);

    expect(summary[0]?.facts.map((fact) => fact.label)).toEqual(["历史最高", "2026 第二赛季 · 最高"]);
  });

  it("falls back to the most recent recorded season when current is missing", () => {
    const summary = presentPublicCompetitiveSummary(catalog, [
      { id: "history", platform: "perfect_world", kind: "historical_peak", platformSeasonKey: null, rank: "gold_s", rating: "1.17", stars: 10 },
      { id: "previous", platform: "perfect_world", kind: "season_peak", platformSeasonKey: "2026s1", rank: "bronze_s", rating: "1.10", stars: 8 },
    ]);

    expect(summary[0]?.facts.map((fact) => fact.label)).toEqual(["历史最高", "2026 第一赛季 · 最高"]);
  });

  it("keeps an explicit current unranked fact instead of falling back", () => {
    const summary = presentPublicCompetitiveSummary(catalog, [
      { id: "history", platform: "perfect_world", kind: "historical_peak", platformSeasonKey: null, rank: "gold_s", rating: "1.17", stars: 10, achievedSeasonKey: "2026s1" },
      { id: "previous", platform: "perfect_world", kind: "season_peak", platformSeasonKey: "2026s1", rank: "bronze_s", rating: "1.10", stars: 8 },
      { id: "current", platform: "perfect_world", kind: "season_peak", platformSeasonKey: "2026s2", status: "unranked", rank: null, rating: "0.98", stars: null },
    ]);

    expect(summary[0]?.facts).toEqual([
      { label: "历史最高 · 2026 第一赛季", rankLabel: "黄金 S", stars: 10, ratingLabel: "Rating Pro", rating: "1.17" },
      { label: "2026 第二赛季", rankLabel: "未定级", stars: null, ratingLabel: "Rating Pro", rating: "0.98" },
    ]);
  });

  it("does not expose stable platform, season or rank keys", () => {
    const summary = presentPublicCompetitiveSummary(catalog, [
      { id: "history", platform: "perfect_world", kind: "historical_peak", platformSeasonKey: null, rank: "gold_s", rating: "1.17", stars: 10 },
      { id: "current", platform: "perfect_world", kind: "season_peak", platformSeasonKey: "2026s2", rank: "gold_s", rating: "1.17", stars: 10 },
    ]);
    const publicResult = JSON.stringify(summary);

    expect(publicResult).not.toContain("perfect_world");
    expect(publicResult).not.toContain("2026s2");
    expect(publicResult).not.toContain("gold_s");
  });

  it("uses catalog display labels, preserves stars and never exposes stored keys", () => {
    const profile = presentPublicCompetitiveProfile(catalog, [
      { id: "history", platform: "perfect_world", kind: "historical_peak", platformSeasonKey: null, rank: "gold_s", rating: "1.17", stars: 10 },
      { id: "s1", platform: "perfect_world", kind: "season_peak", platformSeasonKey: "2026s1", rank: "bronze_s", rating: "1.10", stars: 8 },
      { id: "s2", platform: "perfect_world", kind: "season_peak", platformSeasonKey: "2026s2", rank: "gold_s", rating: "1.17", stars: 10 },
      { id: "unknown", platform: "unknown", kind: "season_peak", platformSeasonKey: "raw-season", rank: "raw-rank", rating: "9", stars: null },
    ]);
    expect(profile).toEqual([{
      displayName: "完美平台",
      facts: [
        { label: "历史最高", rankLabel: "黄金 S", stars: 10, ratingLabel: "Rating Pro", rating: "1.17" },
        { label: "2026 第二赛季 · 最高", rankLabel: "黄金 S", stars: 10, ratingLabel: "Rating Pro", rating: "1.17" },
        { label: "2026 第一赛季 · 最高", rankLabel: "青铜 S", stars: 8, ratingLabel: "Rating Pro", rating: "1.10" },
      ],
    }]);
  });

  it("uses the shared long-lived role taxonomy and hides unknown persisted keys", () => {
    expect(presentCompetitiveRole("igl")).toBe("IGL（指挥）");
    expect(presentCompetitiveRole("legacy_position")).toBeNull();
  });

  it("presents explicit unranked separately from missing facts and labels historical provenance", () => {
    const profile = presentPublicCompetitiveProfile(catalog, [
      { id: "history", platform: "perfect_world", kind: "historical_peak", platformSeasonKey: null, status: "ranked", rank: "gold_s", rating: "1.17", stars: 10, achievedSeasonKey: "2026s1" },
      { id: "unranked", platform: "perfect_world", kind: "season_peak", platformSeasonKey: "2026s2", status: "unranked", rank: null, rating: null, stars: null, achievedSeasonKey: null },
    ]);
    expect(profile[0]?.facts).toEqual([
      { label: "历史最高 · 2026 第一赛季", rankLabel: "黄金 S", stars: 10, ratingLabel: "Rating Pro", rating: "1.17" },
      { label: "2026 第二赛季", rankLabel: "未定级", stars: null, ratingLabel: null, rating: null },
    ]);
  });
});

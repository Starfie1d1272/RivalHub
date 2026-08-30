import { describe, expect, it } from "vitest";

import { resolveCatalogSeasonRoles, resolvePlatformCatalog, type CompetitivePlatformCatalogEntry } from "@/lib/competitive/catalog";

function entry(overrides?: Partial<CompetitivePlatformCatalogEntry>): CompetitivePlatformCatalogEntry {
  return {
    key: "perfect_world",
    displayName: "完美世界竞技平台",
    ratingLabel: "Rating Pro",
    ranks: [
      { id: "r1", rankKey: "bronze", label: "Bronze", sortOrder: 0 },
      { id: "r2", rankKey: "silver", label: "Silver", sortOrder: 1 },
      { id: "r3", rankKey: "gold", label: "Gold", sortOrder: 2 },
    ],
    seasons: [
      { id: "s1", seasonKey: "s22", label: "S22", sortOrder: 2, active: false, isCurrent: false },
      { id: "s2", seasonKey: "s21", label: "S21", sortOrder: 1, active: true, isCurrent: true },
      { id: "s3", seasonKey: "s20", label: "S20", sortOrder: 0, active: true, isCurrent: false },
    ],
    ...overrides,
  };
}

describe("resolvePlatformCatalog", () => {
  it("resolves current, previous (by chronology) and the ordered ladder", () => {
    const resolved = resolvePlatformCatalog(entry());
    expect(resolved).toEqual({
      currentSeasonKey: "s21",
      previousSeasonKey: "s20",
      rankOrder: ["bronze", "silver", "gold"],
    });
  });

  it("derives previous strictly from chronology, never from a second flag", () => {
    const e = entry();
    e.seasons = [
      { id: "s1", seasonKey: "s21", label: "S21", sortOrder: 1, active: true, isCurrent: true },
      { id: "s2", seasonKey: "s20", label: "S20", sortOrder: 0, active: true, isCurrent: false },
      { id: "s3", seasonKey: "s19", label: "S19", sortOrder: -1, active: true, isCurrent: false },
    ];
    expect(resolvePlatformCatalog(e)?.previousSeasonKey).toBe("s20");
  });

  it("fails closed without a current season", () => {
    const e = entry({ seasons: [entry().seasons[0]!] });
    expect(resolvePlatformCatalog(e)).toBeNull();
  });

  it("fails closed without an active previous season", () => {
    const e = entry({ seasons: [entry().seasons[1]!] });
    expect(resolvePlatformCatalog(e)).toBeNull();
  });

  it("fails closed with an empty ladder", () => {
    expect(resolvePlatformCatalog(entry({ ranks: [] }))).toBeNull();
  });

  it("fails closed for an unknown platform", () => {
    expect(resolvePlatformCatalog(undefined)).toBeNull();
  });

  it("ignores inactive seasons for the current pointer", () => {
    const e = entry();
    e.seasons = [
      { id: "s1", seasonKey: "s21", label: "S21", sortOrder: 1, active: false, isCurrent: true },
      { id: "s2", seasonKey: "s20", label: "S20", sortOrder: 0, active: true, isCurrent: false },
    ];
    expect(resolvePlatformCatalog(e)).toBeNull();
  });

  it("uses the same active-only previous season for every caller", () => {
    const e = entry();
    e.seasons = [
      { id: "s3", seasonKey: "s24", label: "S24", sortOrder: 3, active: true, isCurrent: true },
      { id: "s2", seasonKey: "s23", label: "S23", sortOrder: 2, active: false, isCurrent: false },
      { id: "s1", seasonKey: "s22", label: "S22", sortOrder: 1, active: true, isCurrent: false },
    ];
    expect(resolveCatalogSeasonRoles(e).previous?.seasonKey).toBe("s22");
    expect(resolvePlatformCatalog(e)?.previousSeasonKey).toBe("s22");
  });
});

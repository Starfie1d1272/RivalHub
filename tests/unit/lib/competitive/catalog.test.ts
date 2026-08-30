import { describe, expect, it } from "vitest";

import { assertPlatformRanksMutable, loadCompetitivePlatformCatalog, loadReferencedPlatformRankKeys, resolveLiveCompetitiveContext, temporarySortOrders, resolveCatalogSeasonRoles, resolvePlatformCatalog, toCompetitiveProfileConfig, type CompetitivePlatformCatalogEntry } from "@/lib/competitive/catalog";

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

describe("competitive catalog mutation and snapshot helpers", () => {
  it("allocates temporary sorting slots below every existing value", () => {
    expect(temporarySortOrders([12, 0, -8])).toEqual([-10, -9]);
  });

  it("rejects a sorting range that cannot be safely exchanged", () => {
    expect(() => temporarySortOrders([-2_147_483_646])).toThrow("目录排序值");
  });

  it("adapts only a resolved catalog into the frozen event profile", () => {
    expect(toCompetitiveProfileConfig({
      platform: "fivee",
      currentSeasonKey: "s6",
      previousSeasonKey: "s5",
      rankOrder: ["C+", "A+"],
    })).toEqual({
      platform: "fivee",
      currentSeasonKey: "s6",
      previousSeasonKey: "s5",
      rankOrder: ["C+", "A+"],
    });
  });

  it("groups DB catalog rows by their platform owner", async () => {
    const rows = [
      [{ key: "fivee", displayName: "5E", ratingLabel: "Rating+" }],
      [{ id: "r", platformKey: "fivee", rankKey: "C+", label: "C+", sortOrder: 0 }],
      [{ id: "s", platform: "fivee", seasonKey: "s6", label: "S6", sortOrder: 6, active: true, isCurrent: true }],
    ];
    let call = 0;
    const executor = {
      select: () => ({ from: () => ({ orderBy: () => Promise.resolve(rows[call++]!) }) }),
    };
    await expect(loadCompetitivePlatformCatalog(executor as never)).resolves.toEqual([{
      key: "fivee", displayName: "5E", ratingLabel: "Rating+",
      ranks: [{ id: "r", rankKey: "C+", label: "C+", sortOrder: 0 }],
      seasons: [{ id: "s", seasonKey: "s6", label: "S6", sortOrder: 6, active: true, isCurrent: true }],
    }]);
  });

  it("loads referenced facts and frozen JSON rank keys before allowing a mutation", async () => {
    const executor = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([{ rank: "A+" }]) }) }),
      execute: () => Promise.resolve({ rows: [{ rank: "C+" }] }),
    };
    await expect(loadReferencedPlatformRankKeys(executor as never, "fivee")).resolves.toEqual(new Set(["A+", "C+"]));
    await expect(assertPlatformRanksMutable(executor as never, "fivee", ["C+"])).rejects.toThrow("不能修改");
  });

  it("resolves a live platform only when its current, previous and ladder rows are complete", async () => {
    const rows = [
      [{ key: "fivee" }],
      [
        { id: "s6", seasonKey: "s6", label: "S6", sortOrder: 6, active: true, isCurrent: true },
        { id: "s5", seasonKey: "s5", label: "S5", sortOrder: 5, active: true, isCurrent: false },
      ],
      [{ id: "r", rankKey: "C+", label: "C+", sortOrder: 0 }],
    ];
    let call = 0;
    const executor = {
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(rows[call++]!), orderBy: () => Promise.resolve(rows[call++]!) }) }) }),
    };
    await expect(resolveLiveCompetitiveContext(executor as never, "fivee")).resolves.toEqual({
      platform: "fivee", currentSeasonKey: "s6", previousSeasonKey: "s5", rankOrder: ["C+"],
    });
  });
});

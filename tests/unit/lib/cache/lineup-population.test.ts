import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cacheLife: vi.fn(), cacheTag: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn(), revalidatePath: vi.fn(),
  selection: vi.fn(), leaderboard: vi.fn(), partition: vi.fn(),
}));
vi.mock("next/cache", () => ({ cacheLife: mocks.cacheLife, cacheTag: mocks.cacheTag, updateTag: mocks.updateTag, revalidateTag: mocks.revalidateTag, revalidatePath: mocks.revalidatePath }));
vi.mock("@/db/client", () => ({ db: { transaction: (read: (tx: object) => unknown) => read({}) } }));
vi.mock("@/lib/stats/tournament-query", () => ({ getCurrentStatsSelectionInTx: mocks.selection }));
vi.mock("@/lib/stats/leaderboard-query", () => ({ getLineupStatsPopulation: mocks.leaderboard }));
vi.mock("@/lib/stats/ranking", () => ({ partitionRankingPopulation: mocks.partition }));
vi.mock("@/lib/stats/public-fill", () => ({ observePublicStatsFill: (_name: string, read: () => unknown) => read() }));

import { getLineupCareers } from "@/lib/matches/lineup-comparison-query";
import { PUBLIC_STATS_TAG } from "@/lib/cache/tags";
import { revalidateMatchPaths, revalidatePublicStatsTag, updatePublicPlayerTag, updatePublicSeasonTags } from "@/lib/revalidation";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selection.mockResolvedValue({ currentImportIds: ["import"], roster: ["roster"] });
  mocks.leaderboard.mockResolvedValue([
    { userId: "a", maps: 1, rounds: 20, avgRating: 1, avgAdr: 70, kpr: 0.7, kast: 70, fkpr: 0.1, tradeKpr: 0.1 },
    { userId: "b", maps: 2, rounds: 40, avgRating: 2, avgAdr: 80, kpr: 0.8, kast: 80, fkpr: 0.2, tradeKpr: 0.2 },
  ]);
  mocks.partition.mockReturnValue({ ranked: [{ userId: "b" }] });
});

describe("lineup population cache contract", () => {
  it("uses the fixed cutoff profile, selects the whole population and filters afterwards", async () => {
    const cutoff = "2026-10-01T00:00:00.000Z";
    const result = await getLineupCareers(["b"], "match-a", cutoff);
    expect(mocks.cacheLife).toHaveBeenCalledWith({ stale: 60, revalidate: 3600, expire: 86400 });
    expect(mocks.cacheTag).toHaveBeenCalledWith(PUBLIC_STATS_TAG);
    expect(mocks.selection).toHaveBeenCalledWith(expect.anything(), { before: new Date(cutoff), excludeMatchId: "match-a" });
    expect(mocks.leaderboard).toHaveBeenCalledWith(["import"], ["roster"], expect.anything());
    expect(result).toEqual([{ userId: "b", maps: 2, rounds: 40, qualified: true, rating: 2, adr: 80, kpr: 0.8, kast: 80, firstKill: 0.2, trade: 0.2 }]);
  });

  it("keeps the rolling null cutoff short and forwards distinct match and cutoff inputs", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-31T00:00:00Z"));
      await getLineupCareers(["a"], "match-a", null);
      expect(mocks.cacheLife).toHaveBeenLastCalledWith({ stale: 60, revalidate: 60, expire: 3600 });
      expect(mocks.selection).toHaveBeenLastCalledWith(expect.anything(), { before: new Date(), excludeMatchId: "match-a" });
      await getLineupCareers(["a"], "match-b", "2026-10-02T00:00:00.000Z");
      expect(mocks.selection).toHaveBeenLastCalledWith(expect.anything(), { before: new Date("2026-10-02T00:00:00.000Z"), excludeMatchId: "match-b" });
    } finally { vi.useRealTimers(); }
  });

  it("does no cache or population work for an empty lineup", async () => {
    expect(await getLineupCareers([], "match-a", null)).toEqual([]);
    expect(mocks.cacheTag).not.toHaveBeenCalled();
    expect(mocks.selection).not.toHaveBeenCalled();
  });
});

describe("hard public statistics invalidation", () => {
  it.each([
    ["match action", () => revalidateMatchPaths("season", "match")],
    ["player merge", () => updatePublicPlayerTag("player")],
    ["season action", () => updatePublicSeasonTags("season")],
  ])("expires the population immediately for %s", (_label, invalidate) => {
    invalidate();
    expect(mocks.updateTag).toHaveBeenCalledWith(PUBLIC_STATS_TAG);
  });
  it.each([
    ["match route", () => revalidateMatchPaths("season", "match", { mode: "route" })],
    ["evidence route", () => revalidatePublicStatsTag()],
  ])("expires the population immediately for %s", (_label, invalidate) => {
    invalidate();
    expect(mocks.revalidateTag).toHaveBeenCalledWith(PUBLIC_STATS_TAG, { expire: 0 });
  });
});

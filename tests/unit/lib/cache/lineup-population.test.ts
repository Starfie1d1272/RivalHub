import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cacheLife: vi.fn(), cacheTag: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn(), revalidatePath: vi.fn(),
  selection: vi.fn(), fingerprint: vi.fn(), leaderboard: vi.fn(), partition: vi.fn(),
}));
vi.mock("next/cache", () => ({ cacheLife: mocks.cacheLife, cacheTag: mocks.cacheTag, updateTag: mocks.updateTag, revalidateTag: mocks.revalidateTag, revalidatePath: mocks.revalidatePath }));
vi.mock("@/db/client", () => ({ db: { transaction: (read: (tx: object) => unknown) => read({}) } }));
vi.mock("@/lib/stats/tournament-query", () => ({ getCurrentStatsSelectionInTx: mocks.selection }));
vi.mock("@/lib/stats/leaderboard-query", () => ({ getLineupStatsPopulation: mocks.leaderboard, getLineupStatsFingerprint: mocks.fingerprint }));
vi.mock("@/lib/stats/ranking", () => ({ partitionRankingPopulation: mocks.partition }));
vi.mock("@/lib/stats/public-fill", () => ({ observePublicStatsFill: (_name: string, read: () => unknown) => read() }));

import { getLineupCareers } from "@/lib/matches/lineup-comparison-query";
import { PUBLIC_STATS_TAG } from "@/lib/cache/tags";
import { revalidateMatchPaths, revalidatePublicStatsTag, updatePublicPlayerTag, updatePublicSeasonTags } from "@/lib/revalidation";

let fingerprintId = 0;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.fingerprint.mockResolvedValue(String(++fingerprintId).padStart(64, "0"));
  mocks.selection.mockResolvedValue({ currentImportIds: ["import"], roster: ["roster"] });
  mocks.leaderboard.mockResolvedValue([
    { userId: "a", maps: 1, rounds: 20, avgRating: 1, avgAdr: 70, kpr: 0.7, kast: 70, fkpr: 0.1, tradeKpr: 0.1 },
    { userId: "b", maps: 2, rounds: 40, avgRating: 2, avgAdr: 80, kpr: 0.8, kast: 80, fkpr: 0.2, tradeKpr: 0.2 },
  ]);
  mocks.partition.mockReturnValue({ ranked: [{ userId: "b" }] });
});

describe("lineup population cache contract", () => {
  it("uses the fixed cutoff, selects the whole population and filters afterwards", async () => {
    const cutoff = "2026-10-01T00:00:00.000Z";
    const result = await getLineupCareers(["b"], "match-a", cutoff);
    expect(mocks.fingerprint).toHaveBeenCalledWith(["import"], ["roster"], expect.anything());
    expect(mocks.selection).toHaveBeenCalledWith(expect.anything(), { before: new Date(cutoff), excludeMatchId: "match-a" });
    expect(mocks.leaderboard).toHaveBeenCalledWith(["import"], ["roster"], expect.anything());
    expect(result).toEqual([{ userId: "b", maps: 2, rounds: 40, qualified: true, rating: 2, adr: 80, kpr: 0.8, kast: 80, firstKill: 0.2, trade: 0.2 }]);
  });

  it("selects again for rolling cutoffs and shares only the same fingerprint", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-31T00:00:00Z"));
      await getLineupCareers(["a"], "match-a", null);
      expect(mocks.selection).toHaveBeenLastCalledWith(expect.anything(), { before: new Date(), excludeMatchId: "match-a" });
      await getLineupCareers(["a"], "match-b", "2026-10-02T00:00:00.000Z");
      expect(mocks.selection).toHaveBeenLastCalledWith(expect.anything(), { before: new Date("2026-10-02T00:00:00.000Z"), excludeMatchId: "match-b" });
      expect(mocks.leaderboard).toHaveBeenCalledTimes(1);
      mocks.fingerprint.mockResolvedValue("f".repeat(64));
      await getLineupCareers(["a"], "match-b", null);
      expect(mocks.leaderboard).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it("does no cache or population work for an empty lineup", async () => {
    expect(await getLineupCareers([], "match-a", null)).toEqual([]);
    expect(mocks.fingerprint).not.toHaveBeenCalled();
    expect(mocks.selection).not.toHaveBeenCalled();
  });
});

describe("hard public statistics invalidation", () => {
  it.each([
    ["match action", () => revalidateMatchPaths("season", "match")],
    ["player merge", () => updatePublicPlayerTag("player")],
    ["season action", () => updatePublicSeasonTags("season")],
  ])("invalidates the public stats tag for %s", (_label, invalidate) => {
    invalidate();
    expect(mocks.updateTag).toHaveBeenCalledWith(PUBLIC_STATS_TAG);
  });
  it.each([
    ["match route", () => revalidateMatchPaths("season", "match", { mode: "route" })],
    ["evidence route", () => revalidatePublicStatsTag()],
  ])("invalidates the public stats tag for %s", (_label, invalidate) => {
    invalidate();
    expect(mocks.revalidateTag).toHaveBeenCalledWith(PUBLIC_STATS_TAG, { expire: 0 });
  });
});

import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ careers: vi.fn(), benchmark: vi.fn() }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));
vi.mock("@/lib/stats/tournament-query", () => ({ getPlayerCareerPerformances: mocks.careers }));
vi.mock("@/lib/stats/player-attribute-benchmark", () => ({ getPlayerAttributeBenchmark: mocks.benchmark }));
vi.mock("@/lib/stats/player-attributes", () => ({ projectPlayerAttributeProfile: () => ({ attributes: [] }) }));
import { getPublicLineupStyle } from "@/lib/teams/lineup-style-query";
beforeEach(() => vi.resetAllMocks());
it("skips the global benchmark for a lineup without performance", async () => {
  mocks.careers.mockResolvedValue([{ playerId: "a", maps: 0, rounds: 0, performance: null }]);
  const members = [{ userId: "a", name: "Local player", avatarUrl: null, hasActivePublicSanction: false }];
  expect(await getPublicLineupStyle(members)).toMatchObject([{ userId: "a", maps: 0, attributes: [] }]);
  expect(mocks.benchmark).not.toHaveBeenCalled();
});
it("loads one benchmark for a batched multi-player lineup", async () => {
  mocks.careers.mockResolvedValue(["a", "b"].map(playerId => ({ playerId, maps: 2, rounds: 40, performance: {} })));
  mocks.benchmark.mockResolvedValue({});
  await getPublicLineupStyle(["a", "b"].map(userId => ({ userId, name: userId, avatarUrl: null, hasActivePublicSanction: false })));
  expect(mocks.careers).toHaveBeenCalledExactlyOnceWith(["a", "b"]);
  expect(mocks.benchmark).toHaveBeenCalledTimes(1);
});

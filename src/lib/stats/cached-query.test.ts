import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  stats: vi.fn(),
  career: vi.fn(),
  filterOptions: vi.fn(),
  tag: vi.fn(),
  life: vi.fn(),
}));
vi.mock("@/db/client", () => ({ db: { select: mocks.select } }));
vi.mock("next/cache", () => ({ cacheTag: mocks.tag, cacheLife: mocks.life }));
vi.mock("@/lib/observability/server", () => ({ traceOperation: (_name: string, _options: unknown, work: () => unknown) => work() }));
vi.mock("./tournament-query", () => ({
  getTournamentStats: mocks.stats,
  getPlayerCareerDetail: mocks.career,
  getPlayerCareerFilterOptions: mocks.filterOptions,
  getTournamentTeamDetail: vi.fn(),
  getTournamentMapDetail: vi.fn(),
  getLongTeamCareerDetail: vi.fn(),
  getMatchPlayerDetail: vi.fn(),
}));

import { getPublicPlayerCareerDetail, getPublicTournamentStats } from "./cached-query";

describe("public statistics caching boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.stats.mockResolvedValue({ sample: "public" });
    mocks.career.mockResolvedValue({ performance: null });
    mocks.filterOptions.mockResolvedValue([{ id: "season", slug: "played-event", name: "Played event", maps: ["de_ancient"] }]);
    mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ id: "season" }] }) }) });
  });

  it("keeps authorized draft reads outside the shared cache", async () => {
    await getPublicTournamentStats({ seasonId: "season" }, "draft");
    expect(mocks.stats).toHaveBeenCalledOnce();
    expect(mocks.tag).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("checks current public visibility before looking up cached statistics", async () => {
    mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [] }) }) });
    await expect(getPublicTournamentStats({ seasonId: "season" }, "public")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.stats).not.toHaveBeenCalled();
    expect(mocks.tag).not.toHaveBeenCalled();
  });

  it("tags event and career projections with the shared invalidation dependency", async () => {
    await getPublicTournamentStats({ seasonId: "season" }, "public");
    await getPublicPlayerCareerDetail({ playerId: "player" });
    expect(mocks.tag.mock.calls).toEqual([["public-stats:v1"], ["public-stats:v1"]]);
    expect(mocks.life).toHaveBeenCalledWith({ stale: 60, revalidate: 3600, expire: 86400 });
  });

  it("does not silently retry expensive computation after a cache failure", async () => {
    mocks.tag.mockImplementation(() => { throw new Error("cache unavailable"); });
    await expect(getPublicTournamentStats({ seasonId: "season" }, "public")).rejects.toThrow("cache unavailable");
    expect(mocks.stats).not.toHaveBeenCalled();
  });

  it("collapses invalid player filters to the existing unfiltered scope before caching", async () => {
    await getPublicPlayerCareerDetail({ playerId: "player", eventSlug: "random-one", mapFilter: "de_random_one" });
    await getPublicPlayerCareerDetail({ playerId: "player", eventSlug: "random-two", mapFilter: "de_random_two" });
    expect(mocks.career.mock.calls).toEqual([
      [{ playerId: "player", eventSlug: undefined, mapFilter: undefined }],
      [{ playerId: "player", eventSlug: undefined, mapFilter: undefined }],
    ]);
    await getPublicPlayerCareerDetail({ playerId: "player", eventSlug: "played-event", mapFilter: "de_ancient" });
    expect(mocks.career).toHaveBeenLastCalledWith({ playerId: "player", eventSlug: "played-event", mapFilter: "de_ancient" });
  });

  it("bounds unknown map filters to one empty-sample cache key", async () => {
    await getPublicTournamentStats({ seasonId: "season", mapFilter: "de_random_one" }, "public");
    await getPublicTournamentStats({ seasonId: "season", mapFilter: "de_random_two" }, "public");
    expect(mocks.stats.mock.calls[0]).toEqual(mocks.stats.mock.calls[1]);
    expect(mocks.stats).toHaveBeenLastCalledWith(expect.objectContaining({ mapFilter: "__unknown_map__" }));
  });

  it("rejects nonexistent or unpublished team filters before caching", async () => {
    mocks.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [{ id: "season" }] }) }) });
    mocks.select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [] }) }) });
    await expect(getPublicTournamentStats({ seasonId: "season", teamFilter: "missing-team" }, "public")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.tag).not.toHaveBeenCalled();
    expect(mocks.stats).not.toHaveBeenCalled();
  });
});

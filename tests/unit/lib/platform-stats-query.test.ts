import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rows: [] as unknown[][], stats: vi.fn(), tag: vi.fn(), life: vi.fn() }));
vi.mock("@/db/client", () => {
  const select = () => {
    const rows = mocks.rows.shift() ?? [];
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "where", "orderBy", "innerJoin", "limit"]) chain[method] = () => chain;
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve);
    return chain;
  };
  return { db: { select, selectDistinct: select } };
});
vi.mock("next/cache", () => ({ cacheTag: mocks.tag, cacheLife: mocks.life }));
vi.mock("@/lib/observability/server", () => ({ traceOperation: (_name: string, _meta: unknown, run: () => unknown) => run() }));
vi.mock("@/lib/stats/tournament-query", () => ({ getTournamentStats: mocks.stats }));
vi.mock("@/lib/stats/public-view", () => ({ publicStatsView: (data: unknown) => data }));
import { getPlatformStatsPage } from "@/lib/stats/platform-query";
import { PUBLIC_STATS_TAG } from "@/lib/cache/tags";
const events = [
  { id: "a", slug: "current", name: "Current", status: "playing", stagePlan: null },
  { id: "b", slug: "historic", name: "Historic", status: "archived", stagePlan: null },
];
beforeEach(() => { vi.clearAllMocks(); mocks.rows = []; mocks.stats.mockResolvedValue({ records: [{ pages: 2 }] }); });
describe("platform scope and cache boundary", () => {
  it("keys the aggregate with fresh public IDs including archived events and shares the existing invalidation tag", async () => {
    mocks.rows = [events, [{ name: "de_oldmap", seasonId: "b" }]];
    const result = await getPlatformStatsPage({ mapFilter: "de_oldmap" });
    expect(mocks.stats).toHaveBeenCalledWith(expect.objectContaining({ seasonIds: ["a", "b"], publicOnly: true, mapFilter: "de_oldmap" }));
    expect(mocks.tag).toHaveBeenCalledWith(PUBLIC_STATS_TAG);
    expect(mocks.life).toHaveBeenCalledWith({ stale: 60, revalidate: 3600, expire: 86400 });
    expect(result.events).toEqual(expect.arrayContaining([expect.objectContaining({ slug: "historic", maps: ["de_oldmap"] })]));
    mocks.rows = [[events[0]], []];
    await getPlatformStatsPage({});
    expect(mocks.stats).toHaveBeenLastCalledWith(expect.objectContaining({ seasonIds: ["a"] }));
  });
  it.each([{ event: "draft" }, { event: ["current", "historic"] }, { stage: "swiss" }, { format: "bo7" },
    { event: "current", tab: "overview", teamFilter: "unknown-entry" }, { map: "garbage" }, { tab: "players", map: "de_oldmap" }, { mapFilter: "de_unknown" },
    { tab: "maps", map: "de_oldmap", mapFilter: "de_nuke" }])("rejects invalid scope instead of broadening %j", async (query) => {
    mocks.rows = [events, [{ name: "de_oldmap", seasonId: "b" }]];
    await expect(getPlatformStatsPage(query)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.stats).not.toHaveBeenCalled();
  });
  it("accepts veto-only and planned maps offered by the UI", async () => {
    mocks.rows = [events, [{ name: "de_planned", seasonId: "a" }], [{ name: "de_veto_only", seasonId: "a" }]];
    const result = await getPlatformStatsPage({ event: "current", tab: "maps", map: "de_veto_only" });
    expect(result.maps).toEqual(["de_planned", "de_veto_only"]);
    expect(result.events[0]?.maps).toEqual(result.maps);
  });
  it("validates bounded record pages and never changes the qualification corpus", async () => {
    mocks.rows = [events, []];
    await expect(getPlatformStatsPage({ tab: "records", recordPage: "3" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    mocks.rows = [events, []];
    await getPlatformStatsPage({ tab: "records", recordPage: "2" });
    expect(mocks.stats).toHaveBeenCalledTimes(2); // One aggregate per request, never a page variant.
    expect(mocks.stats).toHaveBeenLastCalledWith(expect.objectContaining({ seasonIds: ["a", "b"], publicOnly: true }));
    expect(mocks.stats.mock.calls.at(-1)?.[0]).not.toHaveProperty("recordPage");
  });
});

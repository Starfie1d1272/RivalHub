import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ stats: vi.fn(), rows: [] as unknown[] }));
vi.mock("@/db/client", () => ({ db: { select: () => {
  const chain = { from: () => chain, where: () => chain, limit: async () => mocks.rows };
  return chain;
} } }));
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));
vi.mock("@/lib/observability/server", () => ({ traceOperation: (_name: string, _meta: unknown, run: () => unknown) => run() }));
vi.mock("@/lib/seasons/public-stage", () => ({ getPublicSeasonStagePresentation: async () => ({ officialStages: [{ key: "play-in" }, { key: "legacy" }] }) }));
vi.mock("@/lib/stats/tournament-query", () => ({ getTournamentStats: mocks.stats }));
import { getPublicTournamentStats } from "@/lib/stats/cached-query";
describe("public stats cache corpus identity", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.rows = [{ id: "event", competitionTemplate: "major", stagePlan: [] }]; });
  it.each(["play-in", "legacy"])("preserves the requested %s stage", async (stage) => {
    await getPublicTournamentStats({ seasonId: "event", stage }, "public");
    expect(mocks.stats).toHaveBeenCalledWith(expect.objectContaining({ seasonId: "event", stage }));
  });
  it("refuses an unknown stage without caching an event aggregate", async () => {
    await expect(getPublicTournamentStats({ seasonId: "event", stage: "typo" }, "public")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.stats).not.toHaveBeenCalled();
  });
  it("still rejects a withdrawn event before using the cache", async () => {
    mocks.rows = [];
    await expect(getPublicTournamentStats({ seasonId: "event", stage: "play-in" }, "public")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.stats).not.toHaveBeenCalled();
  });
});

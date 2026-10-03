import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  player: vi.fn(), career: vi.fn(), benchmark: vi.fn(), select: vi.fn(),
}));
vi.mock("@/db/client", () => ({ db: { select: mocks.select } }));
vi.mock("@/lib/data/public-players", () => ({ getPublicPlayerById: mocks.player }));
vi.mock("@/lib/stats/cached-query", () => ({ getPublicPlayerCareerDetail: mocks.career }));
vi.mock("@/lib/stats/player-attribute-benchmark", () => ({ getPlayerAttributeBenchmark: mocks.benchmark }));
vi.mock("@/lib/stats/availability", () => ({ readOptionalPublicStats: (_operation: string, read: () => Promise<unknown>) => read() }));
vi.mock("@/lib/players/public-record", () => ({ getPublicPlayerRecords: async () => new Map() }));
vi.mock("@/lib/competitive/public-catalog", () => ({ getPublicCompetitiveCatalog: async () => [] }));
vi.mock("@/lib/competitive/presentation", () => ({ presentCompetitiveRole: () => null, presentPublicCompetitiveProfile: () => [] }));
vi.mock("@/lib/education/presentation", () => ({ presentPublicEducationIdentities: () => [] }));
vi.mock("@/lib/recruitment/data", () => ({ getPublicPlayerLft: async () => null }));
vi.mock("@/lib/data/public-seasons", () => ({ getPublicSeasonBySlug: vi.fn() }));
vi.mock("@/lib/seasons/public-results", () => ({ getPublicSeasonResults: vi.fn() }));

import { getPublicPlayerProfileReadModel } from "@/lib/players/public-profile";

describe("player profile statistics loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const rows = Promise.resolve([]);
    const query = Object.assign(rows, {
      from: () => query, innerJoin: () => query, where: () => query, orderBy: () => query,
    });
    mocks.select.mockReturnValue(query);
    mocks.player.mockResolvedValue({ id: "player-1" });
    mocks.career.mockResolvedValue({ performance: null });
  });

  it("does not request the global benchmark for a player without advanced statistics", async () => {
    const result = await getPublicPlayerProfileReadModel("player-1");

    expect(result?.attributes).toBeNull();
    expect(mocks.benchmark).not.toHaveBeenCalled();
  });

  it("rejects an unavailable public identity before starting career or profile queries", async () => {
    mocks.player.mockResolvedValueOnce(null);

    expect(await getPublicPlayerProfileReadModel("missing")).toBeNull();
    expect(mocks.career).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.benchmark).not.toHaveBeenCalled();
  });
});

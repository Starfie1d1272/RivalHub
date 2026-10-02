import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ career: vi.fn(), core: vi.fn(), overlay: vi.fn(), mapProfile: vi.fn() }));
vi.mock("@/lib/stats/cached-query", () => ({ getPublicLongTeamCareerDetail: mocks.career, getPublicTournamentTeamDetail: vi.fn() }));
vi.mock("@/lib/teams/public-profile", () => ({ getPublicTeamProfileCore: mocks.core, getTeamProfileViewerState: mocks.overlay }));
vi.mock("@/lib/stats/availability", () => ({ readOptionalPublicStats: (_operation: string, read: () => Promise<unknown>) => read() }));
vi.mock("@/lib/data/public-seasons", () => ({ getPublicSeasonCatalog: async () => [] }));
vi.mock("@/lib/seasons/public-results", () => ({ getPublicSeasonResults: vi.fn() }));
vi.mock("@/lib/teams/map-profile", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/teams/map-profile")>();
  return { ...original, getPublicTeamMapProfile: mocks.mapProfile };
});
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/lib/stats/public-query", () => ({ getPublicPlayerMapExperienceContext: vi.fn() }));

import { getPublicLongTeamProfileReadModel } from "@/lib/teams/profile-read-model";

describe("team profile statistics reuse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.core.mockResolvedValue({ entries: [{ id: "entry-1", seasonId: "season-1", seasonStatus: "finished" }], currentMembers: [] });
    mocks.overlay.mockResolvedValue({ loggedIn: false });
    mocks.mapProfile.mockResolvedValue({ experienceCoverage: {} });
  });

  it("reuses the career snapshot and excludes an unplayed third map in a BO3 sweep", async () => {
    const completedAt = new Date("2026-09-01T12:00:00Z");
    const matches = [{ id: "match-1", stage: "final", entryAId: "entry-1", entryBId: "entry-2", scoreA: 2, scoreB: 0, completedAt }];
    mocks.career.mockResolvedValue({ official: {
      matches,
      maps: [
        { matchId: "match-1", mapName: "de_nuke", scoreA: 13, scoreB: 5, completedAt },
        { matchId: "match-1", mapName: "de_mirage", scoreA: 13, scoreB: 8, completedAt },
        { matchId: "match-1", mapName: "de_inferno", scoreA: null, scoreB: null, completedAt: null },
      ],
      entries: [{ entryId: "entry-1", matches: 1, matchWins: 1, matchLosses: 0, maps: 2, mapWins: 2, mapLosses: 0 }],
    } });

    const model = await getPublicLongTeamProfileReadModel("team-1");

    expect(mocks.core).toHaveBeenCalledWith("team-1", undefined, matches);
    expect(mocks.mapProfile).toHaveBeenCalledWith(["entry-1"], [], {
      playedStages: ["final"],
      own: [{ mapName: "de_mirage", wins: 1, played: 1 }, { mapName: "de_nuke", wins: 1, played: 1 }],
    });
    expect(model?.career[0]).toMatchObject({ matchWins: 1, matchLosses: 0, maps: 2, mapWins: 2, mapLosses: 0 });
  });
});

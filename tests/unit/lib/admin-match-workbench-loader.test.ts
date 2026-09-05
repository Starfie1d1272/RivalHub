import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  seasonFindFirstMock,
  matchFindFirstMock,
  entryFindManyMock,
  mapFindManyMock,
  postMatchFindFirstMock,
  requireSeasonAdminMock,
  selectMock,
} = vi.hoisted(() => ({
  seasonFindFirstMock: vi.fn(),
  matchFindFirstMock: vi.fn(),
  entryFindManyMock: vi.fn(),
  mapFindManyMock: vi.fn(),
  postMatchFindFirstMock: vi.fn(),
  requireSeasonAdminMock: vi.fn(),
  selectMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    query: {
      seasons: { findFirst: seasonFindFirstMock },
      matches: { findFirst: matchFindFirstMock },
      competitionEntries: { findMany: entryFindManyMock },
      matchMaps: { findMany: mapFindManyMock },
      postMatchReports: { findFirst: postMatchFindFirstMock },
    },
    select: selectMock,
  },
}));
vi.mock("@/lib/auth/session", () => ({ requireSeasonAdmin: requireSeasonAdminMock }));

import { loadAdminMatchWorkbench } from "@/lib/admin/matches/workbench";

function selectBuilder<T>(result: T) {
  const builder = {
    from: vi.fn(() => builder),
    innerJoin: vi.fn(() => builder),
    leftJoin: vi.fn(() => builder),
    where: vi.fn(() => Promise.resolve(result)),
  };
  return builder;
}

const season = {
  id: "season-1",
  slug: "major",
  name: "Major",
  stagePlan: [],
  registrationConfig: { mapPool: ["de_inferno"] },
};

const match = {
  id: "match-1",
  seasonId: "season-1",
  entryAId: "entry-a",
  entryBId: "entry-b",
  stage: "qualifier",
  round: null,
  format: "bo1",
  entryRound: null,
  scoreA: null,
  scoreB: null,
  status: "scheduled",
  isForfeit: false,
  bracketNodeId: null,
  ownership: "manual",
  majorStageRunId: null,
  managedKey: null,
  scheduledAt: null,
  completionDeadline: null,
  completedAt: null,
  videoUrl: null,
  mvpWinnerUserId: null,
  createdAt: new Date("2026-09-05T00:00:00Z"),
  updatedAt: new Date("2026-09-05T00:00:00Z"),
};

describe("loadAdminMatchWorkbench", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seasonFindFirstMock.mockResolvedValue(season);
    matchFindFirstMock.mockResolvedValue(match);
    entryFindManyMock.mockResolvedValue([
      { id: "entry-a", name: "Alpha" },
      { id: "entry-b", name: "Beta" },
    ]);
    mapFindManyMock.mockResolvedValue([]);
    postMatchFindFirstMock.mockResolvedValue(undefined);
    requireSeasonAdminMock.mockResolvedValue({ userId: "admin-1" });
    selectMock.mockImplementation(() => selectBuilder([]));
  });

  it("authorizes a valid scoped match before loading detail facts", async () => {
    const result = await loadAdminMatchWorkbench({ seasonSlug: "major", matchId: "match-1" });

    expect(requireSeasonAdminMock).toHaveBeenCalledWith("season-1");
    expect(result).toMatchObject({
      season: { id: "season-1", slug: "major" },
      match: { id: "match-1", seasonId: "season-1" },
      teamAName: "Alpha",
      teamBName: "Beta",
    });
  });

  it("returns null before authorization or detail queries for a cross-season match id", async () => {
    matchFindFirstMock.mockResolvedValue(undefined);

    const result = await loadAdminMatchWorkbench({ seasonSlug: "major", matchId: "match-from-other-season" });

    expect(result).toBeNull();
    expect(requireSeasonAdminMock).not.toHaveBeenCalled();
    expect(entryFindManyMock).not.toHaveBeenCalled();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("returns null for an unknown season before looking up a match", async () => {
    seasonFindFirstMock.mockResolvedValue(undefined);

    const result = await loadAdminMatchWorkbench({ seasonSlug: "missing-season", matchId: "match-1" });

    expect(result).toBeNull();
    expect(matchFindFirstMock).not.toHaveBeenCalled();
    expect(requireSeasonAdminMock).not.toHaveBeenCalled();
  });

  it("does not render detail data when the season admin guard rejects", async () => {
    requireSeasonAdminMock.mockRejectedValue(new Error("FORBIDDEN"));

    await expect(loadAdminMatchWorkbench({ seasonSlug: "major", matchId: "match-1" })).rejects.toThrow("FORBIDDEN");
    expect(entryFindManyMock).not.toHaveBeenCalled();
    expect(selectMock).not.toHaveBeenCalled();
  });
});

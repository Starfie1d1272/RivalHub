import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  batch: vi.fn(), basics: vi.fn(), core: vi.fn(), viewer: vi.fn(),
}));
vi.mock("@/lib/competition-entries/public-team-context", () => ({ getPublicEventTeamMatchFactsBatch: mocks.batch }));
vi.mock("@/lib/teams/public-profile", () => ({
  getPublicTeamProfileBasics: mocks.basics, getPublicTeamProfileCore: mocks.core, getTeamProfileViewerState: mocks.viewer,
}));
vi.mock("@/lib/teams/lineup-style-query", () => ({ getPublicLineupStyle: async () => null }));
vi.mock("@/lib/stats/cached-query", () => ({ getPublicLongTeamCareerDetail: async () => null }));
vi.mock("@/lib/teams/map-profile", () => ({ getPublicTeamMapProfile: async () => ({ experienceCoverage: "unavailable" }) }));
vi.mock("@/lib/data/public-seasons", () => ({ getPublicSeasonCatalog: async () => [] }));
vi.mock("@/lib/seasons/public-results", () => ({ getPublicSeasonResults: vi.fn() }));

import { getPublicLongTeamProfileReadModel } from "@/lib/teams/profile-read-model";

it("keeps season decorations and match deduplication when batching linked entries with unavailable analytics", async () => {
  const entries = [
    { id: "old-a", seasonId: "old", seasonSlug: "old-slug", seasonName: "Old event", seasonStatus: "archived" },
    { id: "old-b", seasonId: "old", seasonSlug: "old-slug", seasonName: "Old event", seasonStatus: "archived" },
    { id: "new-a", seasonId: "new", seasonSlug: "new-slug", seasonName: "New event", seasonStatus: "playing" },
  ];
  mocks.basics.mockResolvedValue({ currentMembers: [] });
  mocks.core.mockResolvedValue({ entries, currentMembers: [] });
  mocks.viewer.mockResolvedValue({ canManage: false });
  mocks.batch.mockResolvedValue(new Map([
    ["old", new Map([
      ["old-a", { matches: [{ id: "same-match", opponentName: "First perspective" }] }],
      ["old-b", { matches: [{ id: "same-match", opponentName: "Last perspective" }] }],
    ])],
    ["new", new Map([["new-a", { matches: [{ id: "new-match", opponentName: "New opponent" }] }]])],
  ]));

  const result = await getPublicLongTeamProfileReadModel("long-team", "viewer");

  expect(mocks.batch).toHaveBeenCalledExactlyOnceWith([
    { seasonId: "old", entryIds: ["old-a", "old-b"] },
    { seasonId: "new", entryIds: ["new-a"] },
  ]);
  expect(result?.matches).toEqual([
    { id: "same-match", opponentName: "Last perspective", seasonSlug: "old-slug", seasonName: "Old event" },
    { id: "new-match", opponentName: "New opponent", seasonSlug: "new-slug", seasonName: "New event" },
  ]);
  expect(result?.statsUnavailable).toBe(true);
  expect(mocks.viewer).toHaveBeenCalledWith({ currentMembers: [] }, "viewer");
});

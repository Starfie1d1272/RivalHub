import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePathMock = vi.hoisted(() => vi.fn());
const updateTagMock = vi.hoisted(() => vi.fn());
const revalidateTagMock = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
  updateTag: updateTagMock,
  revalidateTag: revalidateTagMock,
}));

import {
  revalidateMatchPaths,
  revalidatePublicSeasonTags,
  revalidateSeasonPaths,
  updatePublicPlayerTag,
  updatePublicStatsTag,
  revalidatePublicStatsTag,
} from "@/lib/revalidation";

describe("scoped revalidation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("revalidates only the requested season pages", () => {
    revalidateSeasonPaths("major-2027", ["register", "captains"]);
    expect(revalidatePathMock.mock.calls).toEqual([["/major-2027/register"], ["/major-2027/captains"]]);
    expect(updateTagMock.mock.calls).toEqual([
      ["public-stats:v1"],
      ["public-season-catalog"],
      ["public-season:major-2027"],
      ["public-home"],
    ]);
  });

  it("includes both match indexes and the specific match", () => {
    revalidateMatchPaths("major-2027", "match-1");
    expect(revalidatePathMock.mock.calls).toEqual([
      ["/major-2027/matches"],
      ["/admin/major-2027/matches"],
      ["/admin/major-2027/matches/match-1"],
      ["/major-2027/matches/match-1"],
    ]);
  });

  it("uses stale-while-revalidate tags from route handlers", () => {
    revalidatePublicSeasonTags("major-2027", "season-1");
    expect(revalidateTagMock.mock.calls).toEqual([
      ["public-stats:v1", { expire: 0 }],
      ["public-season-catalog", "max"],
      ["public-season:major-2027", "max"],
      ["public-home", "max"],
      ["season-participants:season-1", "max"],
      ["season-matches:season-1", "max"],
      ["season-standings:season-1", "max"],
    ]);
  });

  it("keeps statistics cached for season changes that do not affect statistical inputs", () => {
    revalidateSeasonPaths("major-2027", ["captains", "adminCaptains"], { statistics: false });
    expect(updateTagMock.mock.calls).toEqual([
      ["public-season-catalog"],
      ["public-season:major-2027"],
      ["public-home"],
    ]);
    expect(revalidatePathMock.mock.calls).toEqual([["/major-2027/captains"], ["/admin/major-2027/captains"]]);
  });

  it.each(["action", "route"] as const)("refreshes match scheduling views without evicting statistics in %s mode", (mode) => {
    revalidateMatchPaths("major-2027", "match-1", { mode, statistics: false });
    expect(updateTagMock).not.toHaveBeenCalledWith("public-stats:v1");
    expect(revalidateTagMock).not.toHaveBeenCalledWith("public-stats:v1", { expire: 0 });
    expect(revalidatePathMock.mock.calls).toEqual([
      ["/major-2027/matches"],
      ["/admin/major-2027/matches"],
      ["/admin/major-2027/matches/match-1"],
      ["/major-2027/matches/match-1"],
    ]);
    if (mode === "route") expect(revalidateTagMock).toHaveBeenCalledWith("public-season:major-2027", "max");
    else expect(updateTagMock).toHaveBeenCalledWith("public-season:major-2027");
  });

  it("invalidates the public player tag without including identity data", () => {
    updatePublicPlayerTag("user-1");
    expect(updateTagMock).toHaveBeenCalledWith("public-player:user-1");
    expect(updateTagMock).toHaveBeenCalledWith("public-stats:v1");
  });

  it("expires shared statistics immediately in both supported mutation contexts", () => {
    updatePublicStatsTag();
    revalidatePublicStatsTag();
    expect(updateTagMock.mock.calls).toEqual([["public-stats:v1"]]);
    expect(revalidateTagMock.mock.calls).toEqual([["public-stats:v1", { expire: 0 }]]);
  });
});

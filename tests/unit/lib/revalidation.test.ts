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
} from "@/lib/revalidation";

describe("scoped revalidation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("revalidates only the requested season pages", () => {
    revalidateSeasonPaths("major-2027", ["register", "captains"]);
    expect(revalidatePathMock.mock.calls).toEqual([["/major-2027/register"], ["/major-2027/captains"]]);
    expect(updateTagMock.mock.calls).toEqual([
      ["public-season-catalog"],
      ["public-season:major-2027"],
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
      ["public-season-catalog", "max"],
      ["public-season:major-2027", "max"],
      ["season-participants:season-1", "max"],
      ["season-matches:season-1", "max"],
      ["season-standings:season-1", "max"],
    ]);
  });

  it("invalidates the public player tag without including identity data", () => {
    updatePublicPlayerTag("user-1");
    expect(updateTagMock).toHaveBeenCalledWith("public-player:user-1");
  });
});

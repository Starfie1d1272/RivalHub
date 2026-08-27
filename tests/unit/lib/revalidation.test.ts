import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePathMock = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { revalidateMatchPaths, revalidateSeasonPaths } from "@/lib/revalidation";

describe("scoped revalidation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("revalidates only the requested season pages", () => {
    revalidateSeasonPaths("major-2027", ["register", "captains"]);
    expect(revalidatePathMock.mock.calls).toEqual([["/major-2027/register"], ["/major-2027/captains"]]);
  });

  it("includes both match indexes and the specific match", () => {
    revalidateMatchPaths("major-2027", "match-1");
    expect(revalidatePathMock.mock.calls).toEqual([
      ["/major-2027/matches"],
      ["/admin/major-2027/matches"],
      ["/major-2027/matches/match-1"],
    ]);
  });
});

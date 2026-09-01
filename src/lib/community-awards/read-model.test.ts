import { describe, expect, it } from "vitest";
import { isPublicCommunityAward } from "@/lib/community-awards/read-model";

describe("community award public projection", () => {
  it("keeps a previously public withdrawn award but hides a pre-review withdrawal", () => {
    expect(isPublicCommunityAward("withdrawn", new Date())).toBe(true);
    expect(isPublicCommunityAward("withdrawn", null)).toBe(false);
    expect(isPublicCommunityAward("approved", new Date())).toBe(true);
    expect(isPublicCommunityAward("pending_review", null)).toBe(false);
  });
});

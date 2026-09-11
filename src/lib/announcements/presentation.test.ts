import { describe, expect, it } from "vitest";
import { isAnnouncementAttentionEligible, selectAttentionAnnouncement, selectLatestAnnouncement } from "./presentation";

const base = { status: "published" as const, requiresAttention: true, attentionUntil: null, scope: "site" as const, publishedAt: new Date("2026-09-10T00:00:00Z"), updatedAt: new Date("2026-09-10T00:00:00Z"), id: "a" };

describe("announcement presentation", () => {
  it("does not present expired attention as eligible", () => {
    expect(isAnnouncementAttentionEligible({ ...base, attentionUntil: new Date("2026-09-09T00:00:00Z") }, new Date("2026-09-10T00:00:00Z"))).toBe(false);
  });

  it("prefers current season attention over site attention", () => {
    const selected = selectAttentionAnnouncement([
      { ...base, id: "site", scope: "site" },
      { ...base, id: "season", scope: "season", publishedAt: new Date("2026-09-01T00:00:00Z") },
    ], "season-id");
    expect(selected?.id).toBe("season");
  });

  it("selects latest publication with stable updated/id tie breaks", () => {
    const selected = selectLatestAnnouncement([
      { ...base, id: "older" },
      { ...base, id: "newer", publishedAt: new Date("2026-09-11T00:00:00Z") },
    ]);
    expect(selected?.id).toBe("newer");
  });
});

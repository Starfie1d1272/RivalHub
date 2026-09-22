import { describe, expect, it } from "vitest";
import { resolveAnnouncementPublishedAt } from "./commands";

describe("announcement publication timestamps", () => {
  const old = new Date("2026-09-01T00:00:00Z");
  const now = new Date("2026-09-11T00:00:00Z");

  it("refreshes publication time when a draft is published again", () => {
    expect(resolveAnnouncementPublishedAt({ status: "draft", publishedAt: old }, "published", now)).toBe(now);
  });

  it("keeps the original time for an already published announcement", () => {
    expect(resolveAnnouncementPublishedAt({ status: "published", publishedAt: old }, "published", now)).toBe(old);
  });

  it("keeps the publication history when withdrawing", () => {
    expect(resolveAnnouncementPublishedAt({ status: "published", publishedAt: old }, "draft", now)).toBe(old);
  });
});

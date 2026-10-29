import { describe, expect, it } from "vitest";
import { broadcastStatsCutoff } from "./stats-scope";

describe("broadcast stats cutoff", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  const earlier = new Date("2026-10-29T10:00:00Z");
  const later = new Date("2026-10-29T14:00:00Z");
  it("prefers the actual start over schedule and generation time", () => {
    expect(broadcastStatsCutoff(earlier, later, now)).toEqual({ cutoffAt: earlier, cutoffSource: "startedAt" });
  });
  it("uses the earlier of schedule and generation time, including missing schedule", () => {
    expect(broadcastStatsCutoff(null, earlier, now)).toEqual({ cutoffAt: earlier, cutoffSource: "scheduledAt" });
    expect(broadcastStatsCutoff(null, later, now)).toEqual({ cutoffAt: now, cutoffSource: "generatedAt" });
    expect(broadcastStatsCutoff(null, null, now)).toEqual({ cutoffAt: now, cutoffSource: "generatedAt" });
  });
});

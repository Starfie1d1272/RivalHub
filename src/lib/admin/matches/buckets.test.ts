import { describe, expect, it } from "vitest";
import { projectAdminMatchBuckets } from "./buckets";

describe("admin match bucket priority", () => {
  it("shows each match in only its highest priority task bucket", () => {
    const now = Date.now();
    const matches = [
      { id: "attention-live", status: "in_progress", scheduledAt: new Date(now), demoNeedsAttentionCount: 1 },
      { id: "live", status: "in_progress", scheduledAt: new Date(now), demoNeedsAttentionCount: 0 },
      { id: "soon", status: "scheduled", scheduledAt: new Date(now), demoNeedsAttentionCount: 0 },
      { id: "unscheduled", status: "scheduled", scheduledAt: null, demoNeedsAttentionCount: 0 },
    ];
    const groups = projectAdminMatchBuckets(matches, new Set(), now);
    expect(groups.map(group => group.matches.map(match => match.id))).toEqual([["attention-live"], ["live"], ["soon"], ["unscheduled"]]);
  });
});

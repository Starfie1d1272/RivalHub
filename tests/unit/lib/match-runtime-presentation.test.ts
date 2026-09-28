import { describe, expect, it } from "vitest";
import { deriveMatchPresentationPhase, projectMatchPrimaryTask } from "@/lib/matches/runtime-presentation";
import { acceptsLiveDelivery, liveFreshness, type PublicLiveMatchProjection } from "@/lib/mizar/live-projection";

describe("match runtime presentation", () => {
  it("keeps the match in veto until the canonical veto plan is complete", () => {
    const base = { status: "in_progress" as const, lineupsReady: true, vetoStarted: true, vetoCompleted: false, mapExecution: "waiting" as const, completedMaps: 0 };
    expect(deriveMatchPresentationPhase(base)).toBe("veto");
    expect(deriveMatchPresentationPhase({ ...base, vetoCompleted: true })).toBe("waiting_gameplay");
    expect(deriveMatchPresentationPhase({ ...base, vetoCompleted: true, mapExecution: "gameplay" })).toBe("gameplay");
    expect(deriveMatchPresentationPhase({ ...base, vetoCompleted: true, mapExecution: "inter_map" })).toBe("inter_map");
    expect(deriveMatchPresentationPhase({ ...base, status: "finished" })).toBe("post");
  });

  it("prioritizes the task that the viewer can actually perform", () => {
    const base = { phase: "preparing" as const, needsAttention: false, scheduledAt: null, isAdmin: false, isTeamRepresentative: true, isBpRepresentative: false, lineupsReady: false };
    expect(projectMatchPrimaryTask(base).key).toBe("schedule");
    expect(projectMatchPrimaryTask({ ...base, scheduledAt: new Date() }).key).toBe("lineup");
    expect(projectMatchPrimaryTask({ ...base, scheduledAt: new Date(), lineupsReady: true, isBpRepresentative: true }).key).toBe("veto");
    expect(projectMatchPrimaryTask({ ...base, isAdmin: true, needsAttention: true }).key).toBe("review");
  });
});

describe("public live delivery", () => {
  const delivery = (authorityRevision: number, sequence: number, producedAt = "2026-09-28T00:00:00Z") => ({ matchId: "match", producedAt, delivery: { authorityRevision, generation: 1, epoch: 1, sequence } }) as PublicLiveMatchProjection;

  it("drops stale frames across source takeover and accepts a fresh heartbeat", () => {
    const current = delivery(2, 100);
    expect(acceptsLiveDelivery(current, delivery(1, 999), "match")).toBe(false);
    expect(acceptsLiveDelivery(current, delivery(3, 0), "match")).toBe(true);
    expect(acceptsLiveDelivery(current, delivery(2, 100, "2026-09-28T00:00:01Z"), "match")).toBe(true);
    expect(acceptsLiveDelivery(current, { ...delivery(2, 101), matchId: "other" }, "match")).toBe(false);
  });

  it("marks interrupted live data stale before it becomes unavailable", () => {
    expect(liveFreshness(2_999)).toBe("fresh");
    expect(liveFreshness(3_001)).toBe("stale");
    expect(liveFreshness(10_001)).toBe("unavailable");
  });
});

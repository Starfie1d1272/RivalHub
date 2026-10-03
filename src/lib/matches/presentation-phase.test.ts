import { describe, expect, it } from "vitest";
import { projectMatchPresentationPhase as phase, type MatchPhaseFacts } from "./presentation-phase";
const base: MatchPhaseFacts = { status: "in_progress", scheduledAt: null, startedAt: null, completedAt: null, veto: "not_started", maps: [], gameplayMapId: null };
describe("shared canonical match phase", () => {
  it("requires veto/gameplay facts rather than in_progress", () => {
    expect(phase(base)).toBe("preparation");
    expect(phase({ ...base, scheduledAt: "2026-10-03" })).toBe("awaiting_veto");
    expect(phase({ ...base, veto: "in_progress" })).toBe("veto");
    expect(phase({ ...base, veto: "completed" })).toBe("awaiting_gameplay");
  });
  it("only uses the next uncompleted map and preserves BO3 2:0 POST", () => {
    const facts: MatchPhaseFacts = { ...base, veto: "completed", maps: [{ id: "decider", order: 3, completedAt: null }, { id: "one", order: 1, completedAt: "done" }, { id: "two", order: 2, completedAt: null }], gameplayMapId: "one" };
    expect(phase(facts)).toBe("inter_map");
    expect(phase({ ...facts, gameplayMapId: "two" })).toBe("gameplay");
    expect(phase({ ...facts, status: "finished", gameplayMapId: "decider" })).toBe("post");
    expect(phase({ ...facts, status: "cancelled" })).toBe("cancelled");
  });
});

it("projects phases from their owners without turning in_progress into gameplay", () => {
 expect(phase(base)).toBe("preparation");
 expect(phase({ ...base, scheduledAt: "2026-10-03" })).toBe("awaiting_veto");
 expect(phase({ ...base, status: "in_progress", veto: "in_progress" })).toBe("veto");
 expect(phase({ ...base, status: "in_progress", veto: "completed" })).toBe("awaiting_gameplay");
 const maps = [{ id: "a", order: 1, completedAt: "2026-10-03" }, { id: "b", order: 2, completedAt: null }];
 expect(phase({ ...base, maps, veto: "completed" })).toBe("inter_map");
 expect(phase({ ...base, maps, veto: "completed", gameplayMapId: "b" })).toBe("gameplay");
 expect(phase({ ...base, maps, status: "finished", gameplayMapId: "b" })).toBe("post");
 expect(phase({ ...base, status: "cancelled" })).toBe("cancelled");
});

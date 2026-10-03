import { it, expect } from "vitest";
import { projectMatchPresentationPhase, type MatchPhaseFacts } from "./presentation-phase";
const base: MatchPhaseFacts = { status: "scheduled", scheduledAt: null, startedAt: null, completedAt: null, veto: "not_started", maps: [], gameplayMapId: null };
it("projects phases from their owners without turning in_progress into gameplay", () => {
 expect(projectMatchPresentationPhase(base)).toBe("preparation");
 expect(projectMatchPresentationPhase({ ...base, scheduledAt: "2026-10-03" })).toBe("awaiting_veto");
 expect(projectMatchPresentationPhase({ ...base, status: "in_progress", veto: "in_progress" })).toBe("veto");
 expect(projectMatchPresentationPhase({ ...base, status: "in_progress", veto: "completed" })).toBe("awaiting_gameplay");
 const maps = [{ id: "a", order: 1, completedAt: "2026-10-03" }, { id: "b", order: 2, completedAt: null }];
 expect(projectMatchPresentationPhase({ ...base, maps, veto: "completed" })).toBe("inter_map");
 expect(projectMatchPresentationPhase({ ...base, maps, veto: "completed", gameplayMapId: "b" })).toBe("gameplay");
 expect(projectMatchPresentationPhase({ ...base, maps, status: "finished", gameplayMapId: "b" })).toBe("post");
 expect(projectMatchPresentationPhase({ ...base, status: "cancelled" })).toBe("cancelled");
});

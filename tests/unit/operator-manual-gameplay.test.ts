import { expect, it } from "vitest";
import { resolveGameplayMapId } from "@/lib/matches/presentation-phase";
import { projectOperatorWorkflow } from "@/lib/admin/matches/operator-workflow";

it("moves manual operations from room prep to scoring after an explicit map start, then to the next room", () => {
  const maps = [1, 2].map(order => ({ id: `map-${order}`, order, name: order === 1 ? "mirage" : "inferno", startSide: "ct" as const, startedAt: null as string | null, completedAt: null as string | null, scoreboardComplete: false, demoNeedsAttention: false, demoLabel: "待上传" }));
  const workflow = () => projectOperatorWorkflow({ status: "in_progress", isForfeit: false, vetoComplete: true, maps, observedGameplayMapId: resolveGameplayMapId(maps, null) });
  expect(workflow()).toMatchObject({ phase: "awaiting_gameplay", roomMapId: "map-1" });
  maps[0]!.startedAt = "2026-10-19T00:00:00Z";
  expect(workflow()).toMatchObject({ phase: "gameplay", roomMapId: null, manualResultAllowed: true });
  maps[0]!.completedAt = "2026-10-19T00:30:00Z";
  expect(workflow()).toMatchObject({ phase: "inter_map", roomMapId: "map-2", focusMapId: "map-1" });
});

it("preserves live gameplay observation when no official start has been recorded", () => {
  const maps = [{ id: "map-1", startedAt: null, completedAt: null }];
  expect(resolveGameplayMapId(maps, { currentMapId: "map-1", mapExecutionPhase: "gameplay" })).toBe("map-1");
  expect(resolveGameplayMapId(maps, { currentMapId: "map-1", mapExecutionPhase: "waiting" })).toBeNull();
});

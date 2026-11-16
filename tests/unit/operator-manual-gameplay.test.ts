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

it("shows the observed later map while earlier results are missing", () => {
  const maps = [1, 2].map(order => ({ id: `map-${order}`, order, name: order === 1 ? "de_ancient" : "de_mirage", startSide: "ct" as const, startedAt: order === 2 ? "2026-11-15T13:00:00Z" : null, completedAt: null as string | null, scoreboardComplete: false, demoNeedsAttention: false, demoLabel: "待上传" }));
  const session = { currentMapId: 'map-2', mapExecutionPhase: 'gameplay' };
  const gameplay = resolveGameplayMapId(maps, session);
  const workflow = projectOperatorWorkflow({ status: 'in_progress', isForfeit: false, vetoComplete: true, maps, observedGameplayMapId: gameplay, source: { ...session, mapEpoch: 1, manualTakeoverMapEpoch: null, identityHealth: 'healthy', lineupHealth: 'healthy', continuityHealth: 'healthy', autoCanonicalizationArmed: true } });
  expect(workflow).toMatchObject({ phase: 'gameplay', title: 'Map 2 · Mirage 进行中', primaryTask: 'observe' });
  maps[1]!.completedAt = '2026-11-15T14:00:00Z';
  expect(resolveGameplayMapId(maps, { ...session, mapExecutionPhase: 'inter_map' })).toBeNull();
});

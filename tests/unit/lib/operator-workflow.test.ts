import { describe, expect, it } from "vitest";
import { buildPerfectRoomGuide, formatOperatorElapsed, projectOperatorWorkflow, projectOperatorPostMatchTasks, type OperatorMap } from "@/lib/admin/matches/operator-workflow";

const completedAt = "2026-10-01T13:00:00.000Z";
const map = (order: number, completed = false, scoreboardComplete = false): OperatorMap => ({
  id: `map-${order}`, order, name: "de_nuke", startSide: "ct", completedAt: completed ? completedAt : null,
  scoreboardComplete, demoLabel: "待上传", demoNeedsAttention: false,
});
const project = (maps: OperatorMap[], extra: Partial<Parameters<typeof projectOperatorWorkflow>[0]> = {}) => projectOperatorWorkflow({
  status: "in_progress", isForfeit: false, vetoComplete: true, maps, observedGameplayMapId: null, ...extra,
});

describe("single-operator task projection", () => {
  it("keeps missing between-map OCR optional and advances when its fields are complete", () => {
    const pending = project([map(1, true), map(2), map(3)]);
    expect(pending).toMatchObject({ focusMapId: "map-1", roomMapId: "map-2", elapsed: { since: completedAt } });
    expect(pending.description).toContain("可同时补充");
    expect(project([map(1, true, true), map(2), map(3)])).toMatchObject({ focusMapId: null, roomMapId: "map-2", title: "准备 Map 2 · Nuke 房间" });
  });
  it("shows Map3 for an ongoing 1:1, but a completed 2:0 goes straight to post-match despite its unused map", () => {
    const maps = [map(1, true, true), map(2, true, true), map(3)];
    expect(project(maps).roomMapId).toBe("map-3");
    expect(project(maps, { status: "finished" })).toMatchObject({ roomMapId: null, isPostMatch: true, title: "整理赛后资料" });
  });
  it("keeps final-map OCR and Demo tasks available together", () => {
    const result = project([map(1, true), map(2, true), map(3)], { status: "finished" });
    expect(result).toMatchObject({ roomMapId: null, focusMapId: "map-1", isPostMatch: true });
    expect(result.nextStep).toContain("Demo Uploader");
    expect(result.completedMaps).toHaveLength(2);
  });
  it("does not require artifacts for an unplayed forfeit or plan future maps for cancellation", () => {
    expect(project([map(1)], { status: "finished", isForfeit: true })).toMatchObject({ completedMaps: [], roomMapId: null, focusMapId: null });
    expect(project([map(1)], { status: "finished", isForfeit: true }).description).toBe("弃赛结果已记录。");
    expect(project([map(1)], { status: "cancelled" }).roomMapId).toBeNull();
  });
  it("does not infer a room before the BP plan, and never pretends room creation is known", () => {
    expect(project([map(1)], { vetoComplete: false }).roomMapId).toBeNull();
    expect(project([map(1)]).description).toContain("本图结束后记录正式比分");
  });
  it("formats elapsed wall time and clamps future timestamps", () => {
    expect(formatOperatorElapsed(completedAt, Date.parse(completedAt) + 754000)).toBe("+12:34");
    expect(formatOperatorElapsed(completedAt, Date.parse(completedAt) - 1)).toBe("+00:00");
  });
});

describe("Perfect guide", () => {
  it("offers precisely the six distinct copy fields, with fixed A/B and side-only changes", () => {
    const input = { seasonName: "Major", roundLabel: "Stage1", description: "2-1", teamAName: "Alpha", teamBName: "Beta", map: map(2) };
    const guide = buildPerfectRoomGuide(input);
    expect(guide.fields.filter(field => field.copyable).map(({ label, value }) => ({ label, value }))).toEqual([
      { label: "轮次", value: "Stage1" }, { label: "比赛短描述", value: "2-1" },
      { label: "队伍 1", value: "Alpha" }, { label: "队伍 2", value: "Beta" },
      { label: "GOTV 线路 2 延迟", value: "120" }, { label: "GOTV Password", value: "1" },
    ]);
    expect(buildPerfectRoomGuide({ ...input, map: { ...map(3), startSide: "t" } }).fields.filter(field => field.copyable).map(({ label, value }) => ({ label, value }))).toEqual(guide.fields.filter(field => field.copyable).map(({ label, value }) => ({ label, value })));
    expect(guide.fields.find(row => row.label === "选边方式")?.value).toBe("TEAM 1 CT / TEAM 2 T");
    expect(buildPerfectRoomGuide({ ...input, map: { ...map(3), startSide: null } }).fields.find(row => row.label === "选边方式")?.value).toContain("尚未确定");
  });
});

const healthy = { currentMapId: "map-1", mapEpoch: 1, manualTakeoverMapEpoch: null, identityHealth: "healthy", lineupHealth: "healthy", continuityHealth: "healthy", autoCanonicalizationArmed: true };
describe("source and task dimensions", () => {
  it("observes healthy AUTO without manual form", () => expect(project([map(1)], { source: healthy, observedGameplayMapId: "map-1" })).toMatchObject({ primaryTask: "observe", manualResultAllowed: false }));
  it("treats no source as normal manual work", () => {
    const result = project([map(1)]);
    expect(result).toMatchObject({ sourceMode: "none", sourceHealth: "not_applicable", primaryTask: "manual_result", manualResultAllowed: true });
    expect(JSON.stringify(result)).not.toMatch(/返回 Mizar|开播|recovery|degraded/);
  });
  it.each(["identityHealth", "lineupHealth", "continuityHealth"])("prioritizes %s conflicts even after completion", key => {
    expect(project([map(1, true)], { status: "finished", source: { ...healthy, [key]: "conflict" } })).toMatchObject({ primaryTask: "review", sourceHealth: "conflict" });
  });
  it("keeps stale separate from conflict", () => expect(project([map(1)], { source: { ...healthy, freshness: "stale" } })).toMatchObject({ primaryTask: "source_check", sourceHealth: "stale", reviewReasons: [] }));
  it("permits manual result after scoped takeover and returns to AUTO on the next healthy epoch", () => {
    expect(project([map(1)], { source: { ...healthy, manualTakeoverMapEpoch: 1, autoCanonicalizationArmed: false } })).toMatchObject({ sourceMode: "manual_map", manualResultAllowed: true });
    expect(project([map(1, true), map(2)], { source: { ...healthy, mapEpoch: 2, manualTakeoverMapEpoch: 1 }, observedGameplayMapId: "map-2" })).toMatchObject({ primaryTask: "observe", manualResultAllowed: false });
  });
});

it("prioritizes explicit source/result conflicts, and never enables a prior map takeover for the next map", () => {
  for (const continuityHealth of ["source_conflict", "result_conflict"]) expect(project([map(1)], { source: { ...healthy, continuityHealth } }).primaryTask).toBe("review");
  expect(project([map(1, true), map(2)], { source: { ...healthy, manualTakeoverMapEpoch: 1, autoCanonicalizationArmed: false } }).manualResultAllowed).toBe(false);
});

it("separates official, data and production completion for unclaimed, forfeit and played matches", async () => {
  const { projectOperatorCompletion } = await import("@/lib/admin/matches/operator-workflow");
  const base = { status: "finished" as const, isForfeit: false, maps: [map(1, true)], commentatorCount: 0, submitted: true, hasVideo: true };
  expect(projectOperatorCompletion(base)).toEqual({ official: "已完赛", data: "待补齐 OCR / Demo", production: "暂无解说认领" });
  expect(projectOperatorCompletion({ ...base, maps: [], isForfeit: true }).data).toBe("已齐备");
  expect(projectOperatorCompletion({ ...base, maps: [] }).data).toBe("待补齐 OCR / Demo");
  expect(projectOperatorCompletion({ ...base, commentatorCount: 1, maps: [{ ...map(1, true, true), demoComplete: true }] })).toEqual({ official: "已完赛", data: "已齐备", production: "已完成" });
});

it("keeps gameplay and POST free of inter-map timers after stale manual takeover", () => {
 const maps = [map(1, true), map(2), map(3)];
 const source = { ...healthy, currentMapId: "map-2", mapEpoch: 2, manualTakeoverMapEpoch: 2, autoCanonicalizationArmed: false, continuityHealth: "stale" };
 const ongoing = project(maps, { source, observedGameplayMapId: "map-2" });
 expect(ongoing).toMatchObject({ phase: "gameplay", primaryTask: "manual_result", elapsed: null, roomMapId: null });
 expect(ongoing.nextStep).not.toContain("准备");
 expect(project(maps, { source, observedGameplayMapId: "map-2", status: "finished" })).toMatchObject({ phase: "post", elapsed: null });
});

it("keeps the next official room and OCR available after manual completion with an old source conflict", () => {
  const result = project([map(1, true), map(2)], { source: { ...healthy, continuityHealth: "execution_conflict", manualTakeoverMapEpoch: 1, autoCanonicalizationArmed: false }, observedGameplayMapId: "map-1" });
  expect(result).toMatchObject({ primaryTask: "review", phase: "inter_map", roomMapId: "map-2", focusMapId: "map-1", manualResultAllowed: false });
  expect(result.title).toBe("Map 1 已记录 · 准备 Map 2");
  expect(result.nextStep).not.toContain("在本图结束后提交比分");
  expect(project([map(1, true)], { status: "finished", source: { ...healthy, continuityHealth: "execution_conflict", manualTakeoverMapEpoch: 1 } }).nextStep).toContain("赛后资料");
});

// Protects actionable gaps for unclaimed games without duplicating scoreboard or Demo validation.
it("exposes unfinished post-match work independently of assignment and omits completed or unplayed work", () => {
  const base = { status: "finished" as const, isForfeit: false, maps: [map(1, true), map(2)], commentatorCount: 0, submitted: false, hasVideo: false };
  expect(projectOperatorPostMatchTasks(base)).toEqual([
    { label: "Map 1 · 补齐计分板", anchor: "scoreboard-map-1" },
    { label: "Map 1 · Demo 待上传", anchor: "scoreboard-map-1" },
  ]);
  expect(projectOperatorPostMatchTasks({ ...base, maps: [{ ...map(1, true, true), demoComplete: true }, map(2)] })).toEqual([]);
  expect(projectOperatorPostMatchTasks({ ...base, maps: [], isForfeit: true })).toEqual([]);
  expect(projectOperatorPostMatchTasks({ ...base, maps: [] })).toEqual([{ label: "核对已完成比赛的地图记录", anchor: "match-workbench-finished-maps" }]);
  expect(projectOperatorPostMatchTasks({ ...base, status: "cancelled" })).toEqual([]);
  expect(projectOperatorPostMatchTasks({ ...base, commentatorCount: 1 }).slice(-2)).toEqual([
    { label: "确认解说名单", anchor: "match-workbench-finished-postmatch" },
    { label: "登记解说回放", anchor: "match-workbench-finished-postmatch" },
  ]);
});

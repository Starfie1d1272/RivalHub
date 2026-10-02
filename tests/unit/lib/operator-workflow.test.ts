import { describe, expect, it } from "vitest";
import { buildPerfectRoomGuide, formatOperatorElapsed, isOperatorScoreboardComplete, projectOperatorWorkflow, type OperatorMap } from "@/lib/admin/matches/operator-workflow";

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
    expect(pending.description).toContain("可赛后补齐");
    expect(project([map(1, true, true), map(2), map(3)])).toMatchObject({ focusMapId: null, roomMapId: "map-2", title: "确认 Map 2 建房与开播" });
  });
  it("gives an accepted start priority over previous OCR without claiming live health", () => {
    const result = project([map(1, true), map(2), map(3)], { observedGameplayMapId: "map-2" });
    expect(result).toMatchObject({ title: "进行 Map 2 解说", roomMapId: null, focusMapId: null });
    expect(result.completedMaps).toHaveLength(1);
    expect(result.description).toContain("开始记录");
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
    expect(project([map(1)], { status: "finished", isForfeit: true }).description).toContain("无需 OCR 或 Demo");
    expect(project([map(1)], { status: "cancelled" }).roomMapId).toBeNull();
  });
  it("does not infer a room before the BP plan, and never pretends room creation is known", () => {
    expect(project([map(1)], { vetoComplete: false }).roomMapId).toBeNull();
    expect(project([map(1)]).description).toContain("如果本图已经开始");
  });
  it("formats elapsed wall time and clamps future timestamps", () => {
    expect(formatOperatorElapsed(completedAt, Date.parse(completedAt) + 754000)).toBe("+12:34");
    expect(formatOperatorElapsed(completedAt, Date.parse(completedAt) - 1)).toBe("+00:00");
  });
});

describe("platform scoreboard completeness", () => {
  const ids = Array.from({ length: 10 }, (_, i) => `player-${i}`);
  const rows = ids.map(userId => ({ userId, ratingPro: 0, rws: 0, we: 0 }));
  it("requires all three platform fields for all ten bound starters; zeros are valid", () => {
    expect(isOperatorScoreboardComplete(ids, rows)).toBe(true);
    expect(isOperatorScoreboardComplete(ids, rows.map((row, i) => i === 0 ? { ...row, ratingPro: null } : row))).toBe(false);
    expect(isOperatorScoreboardComplete(ids, [...rows.slice(1), { ...rows[0], userId: "substitute" }])).toBe(false);
    expect(isOperatorScoreboardComplete(ids.slice(1), rows)).toBe(false);
    expect(isOperatorScoreboardComplete(ids, Array.from({ length: 10 }, () => rows[0]))).toBe(false);
  });
});

describe("Perfect guide", () => {
  it("offers precisely the six distinct copy fields, with fixed A/B and side-only changes", () => {
    const input = { seasonName: "Major", roundLabel: "Stage1", description: "2-1", teamAName: "Alpha", teamBName: "Beta", map: map(2) };
    const guide = buildPerfectRoomGuide(input);
    expect(guide.copyFields).toEqual([
      { label: "轮次", value: "Stage1" }, { label: "比赛短描述", value: "2-1" },
      { label: "队伍 1", value: "Alpha" }, { label: "队伍 2", value: "Beta" },
      { label: "GOTV 线路 2 延迟", value: "120" }, { label: "GOTV Password", value: "1" },
    ]);
    expect(buildPerfectRoomGuide({ ...input, map: { ...map(3), startSide: "t" } }).copyFields).toEqual(guide.copyFields);
    expect(guide.instructions.find(row => row.label === "选边方式")?.value).toBe("TEAM 1 CT / TEAM 2 T");
    expect(buildPerfectRoomGuide({ ...input, map: { ...map(3), startSide: null } }).instructions.find(row => row.label === "选边方式")?.value).toContain("尚未确定");
  });
});

import { describe, expect, it } from "vitest";
import type { MatchWorkspaceModel } from "@cs2dak/contract";
import { buildDakIdentityMap, compactMatchWorkspace } from "./dak";

describe("buildDakIdentityMap", () => {
  it("uses RivalHub user ids as stable cohort player keys", () => {
    expect(buildDakIdentityMap([
      { steamId64: "111", name: "Alpha", userId: "user-1" },
      { steamId64: "222", name: "Borrowed", userId: "user-1" },
      { steamId64: "333", name: "Unlinked", userId: null },
    ])).toEqual({
      "111": { playerKey: "user:user-1", userId: "user-1", displayName: "Alpha" },
      "222": { playerKey: "user:user-1", userId: "user-1", displayName: "Borrowed" },
    });
  });
});

describe("compactMatchWorkspace", () => {
  it("keeps map tabs & points for heatmap rendering, strips only replay rounds", () => {
    const workspace = {
      tabs: [{ key: "overview" }, { key: "map" }, { key: "replay" }],
      map: { points: [{ x: 1, y: 2 }], modes: [{ key: "position", count: 500 }], status: { hasPositionData: true } },
      replay: { available: true, sampleRate: 8, rounds: [{ roundNumber: 1 }] },
    } as unknown as MatchWorkspaceModel;

    const compact = compactMatchWorkspace(workspace);

    // 所有 tab 保留（前端由 MatchWorkspace 自行决定渲染）
    expect(compact.tabs.map((tab) => tab.key)).toEqual(["overview", "map", "replay"]);
    // map 数据完整保留，供热力图直接渲染
    expect(compact.map.points).toEqual([{ x: 1, y: 2 }]);
    expect(compact.map.modes).toEqual([{ key: "position", count: 500 }]);
    expect(compact.map.status.hasPositionData).toBe(true);
    // replay 逐帧数据清空，由 API Route 按需加载
    expect(compact.replay.available).toBe(false);
    expect(compact.replay.sampleRate).toBeNull();
    expect(compact.replay.rounds).toEqual([]);
  });
});

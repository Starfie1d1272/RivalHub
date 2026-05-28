import { describe, it, expect } from "vitest";
import type { KillFeedItem } from "@/actions/demo-detail";

// 测试杀 grouping 逻辑（从 DemoKillFeed 提取的纯函数）
function groupKillsByRound(kills: KillFeedItem[]): Map<number, KillFeedItem[]> {
  const map = new Map<number, KillFeedItem[]>();
  for (const k of kills) {
    const list = map.get(k.roundNumber);
    if (list) list.push(k);
    else map.set(k.roundNumber, [k]);
  }
  return map;
}

describe("kill feed grouping", () => {
  it("按 roundNumber 分组", () => {
    const kills: KillFeedItem[] = [
      { roundNumber: 1, tick: 100, killerSteamId64: "a", victimSteamId64: "b", weapon: "ak47", headshot: true, tradeKill: false, throughSmoke: false, noScope: false, flashAssist: false, penetratedObjects: null, killerTeamKey: null, victimTeamKey: null, assisterSteamId64: null, killerSide: null, victimSide: null },
      { roundNumber: 1, tick: 200, killerSteamId64: "c", victimSteamId64: "d", weapon: "awp", headshot: false, tradeKill: true, throughSmoke: false, noScope: false, flashAssist: false, penetratedObjects: null, killerTeamKey: null, victimTeamKey: null, assisterSteamId64: null, killerSide: null, victimSide: null },
      { roundNumber: 2, tick: 50, killerSteamId64: "e", victimSteamId64: "f", weapon: "deagle", headshot: false, tradeKill: false, throughSmoke: false, noScope: false, flashAssist: false, penetratedObjects: null, killerTeamKey: null, victimTeamKey: null, assisterSteamId64: null, killerSide: null, victimSide: null },
    ];
    const grouped = groupKillsByRound(kills);
    expect(grouped.get(1)).toHaveLength(2);
    expect(grouped.get(2)).toHaveLength(1);
    expect(grouped.has(3)).toBe(false);
  });

  it("空数组返回空 Map", () => {
    const grouped = groupKillsByRound([]);
    expect(grouped.size).toBe(0);
  });
});

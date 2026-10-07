import { describe, expect, it } from "vitest";
import { betOperationsList, parseBetOperationsQuery } from "./operations";
import type { BetBoardDTO, BetMarketDTO } from "./types";

const market = (id: string, matchId: string | null, state: BetMarketDTO["state"] = "open", group: BetMarketDTO["group"] = "比赛"): BetMarketDTO => ({
  id, matchId, state, group, type: "match_winner", title: "比赛胜者", context: "", help: "", pool: "0", participants: 0,
  canStake: false, restriction: null, mine: null, options: [{ entity: null, id: "choice", label: "银河", pool: "0", percent: 0, winner: false }],
});
const data: BetBoardDTO = {
  seasonId: "season", enabled: true, paused: false, joined: false, balance: "0", debt: "0", profit: "0", rank: null,
  matches: Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, entryAId: `a${i}`, entryBId: `b${i}`, a: `队伍 ${i}`, b: "新星", logoA: null, logoB: null, stage: i === 0 ? "PLAY-IN" : "阶段一", format: "BO3", scheduledAt: null })),
  leaderboard: [], records: [],
  markets: [market("event", null, "locked", "赛事"), ...Array.from({ length: 12 }, (_, i) => market(`market${i}`, `m${i}`)), market("bp", "m0", "locked", "BP")],
};
describe("BET operations query", () => {
  it("combines search, stage, state and category without exposing unrelated markets", () => {
    const list = betOperationsList(data, parseBetOperationsQuery({ q: "队伍 0", stage: "PLAY-IN", state: "locked", category: "BP" }));
    expect(list.total).toBe(1);
    expect(list.groups[0]?.markets.map(m => m.id)).toEqual(["bp"]);
    expect(betOperationsList(data, parseBetOperationsQuery({ q: "银河" })).total).toBe(13);
    expect(betOperationsList(data, parseBetOperationsQuery({ q: "不存在" })).total).toBe(0);
  });
  it("pages whole match groups and clamps a stale page after results shrink", () => {
    const list = betOperationsList(data, parseBetOperationsQuery({ page: "2" }));
    expect(list.total).toBe(13); expect(list.groups).toHaveLength(3);
    const first = betOperationsList(data, parseBetOperationsQuery({}));
    expect(first.groups).toHaveLength(10);
    expect(new Set([...first.groups, ...list.groups].map(g => g.id)).size).toBe(13);
    expect(betOperationsList(data, parseBetOperationsQuery({ q: "队伍 0", page: "999" })).page).toBe(1);
  });
  it("uses deterministic defaults for malformed and repeated query values", () => {
    expect(parseBetOperationsQuery({ state: "secret", category: "unknown", page: "1e999", q: ["a", "b"] })).toEqual({ q: "", state: "", category: "", stage: "", page: 1 });
    expect(betOperationsList(data, parseBetOperationsQuery({ stage: "unknown" })).stage).toBe("");
  });
});

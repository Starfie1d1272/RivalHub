import { describe, expect, it } from "vitest";
import { getWinner, getWinThreshold } from "@/types/match";
import type { Match } from "@/types/match";

function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: "m1",
    seasonId: "s1",
    teamAId: "ta",
    teamBId: "tb",
    stage: "qualifier",
    round: null,
    format: "bo3",
    scoreA: null,
    scoreB: null,
    status: "scheduled",
    bracketNodeId: null,
    scheduledAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("getWinner", () => {
  it("finished 比赛 teamA 分高返回 teamA", () => {
    const m = makeMatch({ status: "finished", scoreA: 2, scoreB: 0 });
    expect(getWinner(m)).toBe("ta");
  });

  it("finished 比赛 teamB 分高返回 teamB", () => {
    const m = makeMatch({ status: "finished", scoreA: 0, scoreB: 2 });
    expect(getWinner(m)).toBe("tb");
  });

  it("平局返回 null", () => {
    const m = makeMatch({ status: "finished", scoreA: 1, scoreB: 1 });
    expect(getWinner(m)).toBeNull();
  });

  it("未结束比赛返回 null", () => {
    expect(getWinner(makeMatch({ status: "scheduled" }))).toBeNull();
    expect(getWinner(makeMatch({ status: "in_progress" }))).toBeNull();
    expect(getWinner(makeMatch({ status: "cancelled" }))).toBeNull();
  });

  it("finished 但无分数返回 null", () => {
    const m = makeMatch({ status: "finished", scoreA: null, scoreB: null });
    expect(getWinner(m)).toBeNull();
  });
});

describe("getWinThreshold", () => {
  it("BO1 需要 1 图", () => {
    expect(getWinThreshold("bo1")).toBe(1);
  });
  it("BO3 需要 2 图", () => {
    expect(getWinThreshold("bo3")).toBe(2);
  });
  it("BO5 需要 3 图", () => {
    expect(getWinThreshold("bo5")).toBe(3);
  });
});

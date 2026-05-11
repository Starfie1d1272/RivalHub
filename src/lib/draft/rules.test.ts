import { describe, it, expect } from "vitest";
import {
  getSnakeOrder,
  getNextTeamId,
  isDraftComplete,
  isStarterRound,
  canPickPosition,
  computeTeamPositionCounts,
  DRAFT_POSITION_LIMIT_PER_TEAM,
} from "@/lib/draft/rules";

// Helper to construct DraftTeamOrder objects
function t(id: string, draftOrder: number) {
  return { id, draftOrder };
}

// 8 teams as used in production
const teams = [
  t("t1", 1),
  t("t2", 2),
  t("t3", 3),
  t("t4", 4),
  t("t5", 5),
  t("t6", 6),
  t("t7", 7),
  t("t8", 8),
];

describe("getSnakeOrder", () => {
  it("round 1: lowest draftOrder picks first (forward)", () => {
    const order = getSnakeOrder(teams, 1);
    expect(order.map((t) => t.draftOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("round 2: reverse order", () => {
    const order = getSnakeOrder(teams, 2);
    expect(order.map((t) => t.draftOrder)).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it("round 3: forward again", () => {
    const order = getSnakeOrder(teams, 3);
    expect(order.map((t) => t.draftOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("round 4: reverse", () => {
    const order = getSnakeOrder(teams, 4);
    expect(order.map((t) => t.draftOrder)).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
  });
});

describe("getNextTeamId", () => {
  it("advances to next team within same round", () => {
    const result = getNextTeamId(teams, "t1", 1);
    expect(result).toEqual({ teamId: "t2", nextRound: 1 });
  });

  it("at end of forward round, flips to next round with reverse order", () => {
    const result = getNextTeamId(teams, "t8", 1);
    expect(result).toEqual({ teamId: "t8", nextRound: 2 });
  });

  it("at end of reverse round, flips to forward next round", () => {
    // Round 2 is reverse, last to pick is t1
    const result = getNextTeamId(teams, "t1", 2);
    expect(result).toEqual({ teamId: "t1", nextRound: 3 });
  });

  it("returns null when draft is complete (round > 6)", () => {
    // DRAFT_TOTAL_ROUNDS = 6, last pick in round 6 is the last pick
    // After that, getNextTeamId should return null
    // Actually round 6 end returns nextRound=7 which exceeds total
    const result = getNextTeamId(teams, "t8", 7);
    expect(result).toBeNull();
  });

  it("returns null for unknown team", () => {
    const result = getNextTeamId(teams, "unknown", 1);
    expect(result).toBeNull();
  });
});

describe("isDraftComplete", () => {
  it("returns true when total picks exceed capacity", () => {
    // DRAFT_TOTAL_ROUNDS=6, DRAFT_TEAMS=8, total capacity = 48
    expect(isDraftComplete(1, "t1", 48)).toBe(true);
  });

  it("returns true when round exceeds total and no current team", () => {
    expect(isDraftComplete(7, null, 0)).toBe(true);
  });

  it("returns false when still in progress", () => {
    expect(isDraftComplete(1, "t1", 0)).toBe(false);
  });
});

describe("isStarterRound", () => {
  it("rounds 1-4 are starter rounds", () => {
    expect(isStarterRound(1)).toBe(true);
    expect(isStarterRound(4)).toBe(true);
  });

  it("rounds 5-6 are not starter rounds", () => {
    expect(isStarterRound(5)).toBe(false);
    expect(isStarterRound(6)).toBe(false);
  });
});

describe("canPickPosition", () => {
  it("allows pick when count is below limit", () => {
    expect(canPickPosition(0)).toBe(true);
    expect(canPickPosition(1)).toBe(true);
  });

  it("rejects pick when count reaches limit", () => {
    expect(canPickPosition(2)).toBe(false);
    expect(canPickPosition(3)).toBe(false);
  });

  it("respects custom limit", () => {
    expect(canPickPosition(2, 3)).toBe(true);
    expect(canPickPosition(3, 3)).toBe(false);
  });
});

describe("computeTeamPositionCounts", () => {
  it("counts positions per team", () => {
    const members = [
      { teamId: "t1", primaryPosition: "igl" },
      { teamId: "t1", primaryPosition: "awper" },
      { teamId: "t1", primaryPosition: "igl" },
      { teamId: "t2", primaryPosition: "igl" },
    ];
    const result = computeTeamPositionCounts(members);
    expect(result.get("t1")?.get("igl")).toBe(2);
    expect(result.get("t1")?.get("awper")).toBe(1);
    expect(result.get("t2")?.get("igl")).toBe(1);
  });
});

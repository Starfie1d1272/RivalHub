import { describe, expect, it } from "vitest";
import {
  getSnakeOrder,
  getNextTeamId,
  isDraftComplete,
  computeTeamPositionCounts,
} from "@/lib/draft/rules";

function team(id: string, draftOrder: number) {
  return { id, draftOrder };
}

// 8 teams with draftOrder 1-8
const ALL_TEAMS = [
  team("t1", 1),
  team("t2", 2),
  team("t3", 3),
  team("t4", 4),
  team("t5", 5),
  team("t6", 6),
  team("t7", 7),
  team("t8", 8),
];

describe("getSnakeOrder", () => {
  it("round 1 (odd) returns forward order", () => {
    const order = getSnakeOrder(ALL_TEAMS, 1);
    expect(order.map((t) => t.id)).toEqual([
      "t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8",
    ]);
  });

  it("round 2 (even) returns reverse order", () => {
    const order = getSnakeOrder(ALL_TEAMS, 2);
    expect(order.map((t) => t.id)).toEqual([
      "t8", "t7", "t6", "t5", "t4", "t3", "t2", "t1",
    ]);
  });

  it("round 3 (odd) returns forward order again", () => {
    const order = getSnakeOrder(ALL_TEAMS, 3);
    expect(order.map((t) => t.id)).toEqual([
      "t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [...ALL_TEAMS];
    getSnakeOrder(input, 2);
    expect(input[0].id).toBe("t1"); // unchanged
  });
});

describe("getNextTeamId", () => {
  it("advances to next team in same round (forward)", () => {
    const next = getNextTeamId(ALL_TEAMS, "t3", 1);
    expect(next).toEqual({ teamId: "t4", nextRound: 1 });
  });

  it("advances to next team in same round (reverse)", () => {
    const next = getNextTeamId(ALL_TEAMS, "t5", 2);
    expect(next).toEqual({ teamId: "t4", nextRound: 2 });
  });

  it("wraps to next round when last team in forward round", () => {
    const next = getNextTeamId(ALL_TEAMS, "t8", 1);
    expect(next).toEqual({ teamId: "t8", nextRound: 2 });
  });

  it("wraps to next round when last team in reverse round", () => {
    const next = getNextTeamId(ALL_TEAMS, "t1", 2);
    expect(next).toEqual({ teamId: "t1", nextRound: 3 });
  });

  it("returns null when draft is complete (round 6, last team)", () => {
    // Round 6 is even, reverse: t8, t7, ..., t1. Last is t1.
    const next = getNextTeamId(ALL_TEAMS, "t1", 6);
    expect(next).toBeNull();
  });

  it("returns null for unknown team", () => {
    const next = getNextTeamId(ALL_TEAMS, "unknown", 1);
    expect(next).toBeNull();
  });
});

describe("isDraftComplete", () => {
  it("returns true when totalPicks >= 48", () => {
    expect(isDraftComplete(6, "t1", 48)).toBe(true);
  });

  it("returns false when totalPicks < 48", () => {
    expect(isDraftComplete(3, "t4", 20)).toBe(false);
  });

  it("returns true when round exceeds total rounds", () => {
    expect(isDraftComplete(7, null, 48)).toBe(true);
  });
});

describe("computeTeamPositionCounts", () => {
  it("counts positions per team", () => {
    const members = [
      { teamId: "a", primaryPosition: "igl" },
      { teamId: "a", primaryPosition: "igl" },
      { teamId: "a", primaryPosition: "awper" },
      { teamId: "b", primaryPosition: "igl" },
    ];
    const result = computeTeamPositionCounts(members);

    expect(result.get("a")?.get("igl")).toBe(2);
    expect(result.get("a")?.get("awper")).toBe(1);
    expect(result.get("b")?.get("igl")).toBe(1);
  });

  it("returns empty map for no members", () => {
    const result = computeTeamPositionCounts([]);
    expect(result.size).toBe(0);
  });
});

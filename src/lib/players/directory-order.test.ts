import { describe, expect, it } from "vitest";
import { sortPlayerDirectory } from "./directory-order";

const players = [
  { id: "alpha", name: "Alpha", currentRating: 1.2, stats: { maps: 4, avgRating: 1.1 } },
  { id: "bravo", name: "Bravo", currentRating: 1.3, stats: { maps: 6, avgRating: 1.02 } },
  { id: "charlie", name: "Charlie", currentRating: 1.4, stats: { maps: 6, avgRating: 1.28 } },
  { id: "delta", name: "Delta", currentRating: 1.5, stats: null },
  { id: "echo", name: "Echo", currentRating: 1.6, stats: null },
];

describe("sortPlayerDirectory", () => {
  it("prioritizes verified maps and season rating before registration fallback", () => {
    expect(sortPlayerDirectory(players).map((player) => player.id)).toEqual([
      "charlie",
      "bravo",
      "alpha",
      "echo",
      "delta",
    ]);
  });

  it("uses the player name as a stable final tie breaker", () => {
    const tiedPlayers = [
      { id: "zulu", name: "Zulu", currentRating: 1.2, stats: null },
      { id: "alpha", name: "Alpha", currentRating: 1.2, stats: null },
    ];

    expect(sortPlayerDirectory(tiedPlayers).map((player) => player.id)).toEqual(["alpha", "zulu"]);
  });
});

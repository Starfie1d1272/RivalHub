import { describe, expect, it } from "vitest";
import { projectRecentMatchResults } from "./recent-results";

describe("recent match results", () => {
  it("orders finished results newest first and projects scores from the selected team's side", () => {
    const results = projectRecentMatchResults("a", [
      { id: "old", entryAId: "a", entryBId: "b", scoreA: 2, scoreB: 0, completedAt: new Date("2026-01-01"), scheduledAt: null, format: "bo3" },
      { id: "new", entryAId: "c", entryBId: "a", scoreA: 0, scoreB: 2, completedAt: new Date("2026-02-01"), scheduledAt: null, format: "bo3" },
      { id: "unfinished", entryAId: "a", entryBId: "c", scoreA: null, scoreB: null, completedAt: null, scheduledAt: new Date("2026-03-01"), format: "bo3" },
    ], new Map([["b", "队伍 B"], ["c", "队伍 C"]]));
    expect(results.map(({ matchId, opponentName, scoreFor, scoreAgainst, won }) => ({ matchId, opponentName, scoreFor, scoreAgainst, won }))).toEqual([
      { matchId: "new", opponentName: "队伍 C", scoreFor: 2, scoreAgainst: 0, won: true },
      { matchId: "old", opponentName: "队伍 B", scoreFor: 2, scoreAgainst: 0, won: true },
    ]);
  });
});

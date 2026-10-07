import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { projectMatchPreAnalysis } from "./pre-analysis";

const match = (id: string, entryAId: string, entryBId: string, scoreA: number, scoreB: number, date: string) => ({
  id,
  seasonId: "season-1",
  entryAId,
  entryBId,
  scoreA,
  scoreB,
  completedAt: new Date(date),
  scheduledAt: null,
  stage: "final",
  format: "bo3",
} as never);

describe("match pre-analysis read model", () => {
  it("keeps map samples, recent results, and head-to-head in the same team scope", () => {
    const result = projectMatchPreAnalysis({
      entryAId: "a",
      entryBId: "b",
      mapPool: ["de_ancient"],
      matchesA: [
        match("h2h-new", "a", "b", 2, 1, "2026-09-02"),
        match("other", "c", "a", 0, 2, "2026-09-01"),
        match("h2h-old", "b", "a", 0, 2, "2026-08-01"),
      ],
      matchesB: [match("b-last", "b", "d", 2, 0, "2026-09-03")],
      entryNames: new Map([["b", "队伍 B"], ["c", "队伍 C"], ["d", "队伍 D"]]),
      mapWinsA: new Map([["de_ancient", { wins: 3, played: 5 }]]),
      mapWinsB: new Map([["de_ancient", { wins: 2, played: 4 }]]),
      picksA: { count: new Map([["de_ancient", 2]]), bpMatchCount: 4 },
      picksB: { count: new Map([["de_ancient", 1]]), bpMatchCount: 3 },
      bansA: { count: new Map(), bpMatchCount: 4 },
      bansB: { count: new Map([["de_ancient", 2]]), bpMatchCount: 3 },
    });

    expect(result.mapProfileRows[0]).toEqual({
      mapName: "de_ancient",
      a: { win: { count: 3, sample: 5 }, pick: { count: 2, sample: 4 }, ban: { count: 0, sample: 4 } },
      b: { win: { count: 2, sample: 4 }, pick: { count: 1, sample: 3 }, ban: { count: 2, sample: 3 } },
    });
    expect(result.recentResultsA.map((row) => row.matchId)).toEqual(["h2h-new", "other", "h2h-old"]);
    expect(result.h2hMatches.map(({ matchId, scoreA, scoreB }) => ({ matchId, scoreA, scoreB }))).toEqual([
      { matchId: "h2h-new", scoreA: 2, scoreB: 1 },
      { matchId: "h2h-old", scoreA: 2, scoreB: 0 },
    ]);
    expect([result.h2hWinsA, result.h2hWinsB]).toEqual([2, 0]);
  });
});

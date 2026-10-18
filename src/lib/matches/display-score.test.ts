import { describe, expect, it } from "vitest";
import { projectDisplayScore } from "./display-score";

// Protect the presentation/outcome boundary: never manufacture round results
// from a series win, ambiguous map facts, or an operator's forfeit decision.
const match = { format: "bo1", status: "finished", isForfeit: false, resultDisposition: "recorded", scoreA: 1, scoreB: 0 };
const map = { mapOrder: 1, scoreA: 13, scoreB: 6, completedAt: new Date("2026-10-01") };
describe("official BO1 display score", () => {
  it("uses confirmed rounds including shutouts and overtime without changing series facts", () => {
    for (const [a, b] of [[13, 6], [13, 0], [16, 14], [19, 17]]) {
      expect(projectDisplayScore(match, [{ ...map, scoreA: a, scoreB: b }])).toEqual({ scoreA: a, scoreB: b, kind: "rounds" });
      expect(projectDisplayScore({ ...match, scoreA: 0, scoreB: 1 }, [{ ...map, scoreA: b, scoreB: a }])).toEqual({ scoreA: b, scoreB: a, kind: "rounds" });
    }
    expect(match).toMatchObject({ scoreA: 1, scoreB: 0 });
  });
  it("retains series results for absent, unfinished, contradictory or ambiguous map facts and forfeits", () => {
    for (const maps of [[], [{ ...map, completedAt: null }], [{ ...map, scoreB: null }], [{ ...map, scoreA: 0, scoreB: 0 }], [{ ...map, scoreA: 6, scoreB: 13 }], [{ ...map, scoreA: 14 }], [{ ...map, mapOrder: 2 }], [map, map]]) {
      expect(projectDisplayScore(match, maps)).toEqual({ scoreA: 1, scoreB: 0, kind: "series" });
    }
    expect(projectDisplayScore({ ...match, isForfeit: true }, [map])).toEqual({ scoreA: 1, scoreB: 0, kind: "series" });
    for (const [scoreA, scoreB] of [[null, null], [1, null], [0, 0], [2, 0]] as const) {
      expect(projectDisplayScore({ ...match, scoreA, scoreB }, [map])).toEqual({ scoreA: null, scoreB: null, kind: "series" });
    }
  });
  it("keeps BO3/BO5 series semantics and hides unfinished/pending/omitted results", () => {
    for (const [format, a, b] of [["bo3", 2, 1], ["bo5", 3, 2]] as const) {
      expect(projectDisplayScore({ ...match, format, scoreA: a, scoreB: b }, [map])).toEqual({ scoreA: a, scoreB: b, kind: "series" });
    }
    for (const input of [{ ...match, status: "scheduled" }, { ...match, status: "in_progress" }, { ...match, status: "cancelled" }, { ...match, resultDisposition: "pending" }, { ...match, resultDisposition: "omitted" }]) {
      expect(projectDisplayScore(input, [map])).toEqual({ scoreA: null, scoreB: null, kind: "series" });
    }
  });
});

import { describe, expect, it } from "vitest";
import { getAdminMatchStartBlockers } from "./start-blockers";

const roster = { rosterId: "roster", starters: ["1", "2", "3", "4", "5"], substitutes: [], vetoRepresentativeEventRosterMemberId: null, status: "confirmed" as const };

describe("match start preflight gate", () => {
  it("blocks a Major start when the authoritative preflight is unavailable", () => {
    expect(getAdminMatchStartBlockers({
      requiresPreflight: true,
      teamAName: "Alpha",
      teamBName: "Beta",
      teamARoster: roster,
      teamBRoster: roster,
      teamAPreflight: null,
      teamBPreflight: null,
    })).toEqual([
      "Alpha 尚未完成首发资格检查",
      "Beta 尚未完成首发资格检查",
    ]);
  });

  it("does not require Major preflight data for non-Major matches", () => {
    expect(getAdminMatchStartBlockers({
      requiresPreflight: false,
      teamAName: "Alpha",
      teamBName: "Beta",
      teamARoster: roster,
      teamBRoster: roster,
      teamAPreflight: null,
      teamBPreflight: null,
    })).toEqual([]);
  });

});

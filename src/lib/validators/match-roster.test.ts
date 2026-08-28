import { describe, expect, it } from "vitest";
import {
  assertAllMembersBelongToTeam,
  validateRosterSelection,
} from "@/lib/matches/roster-rules";

describe("validateRosterSubmission", () => {
  it("accepts exactly 5 starters", () => {
    expect(() => validateRosterSelection(["1", "2", "3", "4", "5"])).not.toThrow();
  });

  it("rejects when team member belongs to wrong team", () => {
    expect(() => assertAllMembersBelongToTeam(["1", "2", "3"], ["1", "2"])).toThrow("队员不属于本队");
  });

});

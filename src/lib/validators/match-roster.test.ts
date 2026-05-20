import { describe, expect, it } from "vitest";
import {
  assertAllMembersBelongToTeam,
  assertRosterSubmissionOpen,
  validateRosterSelection,
} from "@/lib/matches/roster-rules";

describe("validateRosterSubmission", () => {
  it("accepts exactly 5 starters", () => {
    expect(() => validateRosterSelection(["1", "2", "3", "4", "5"])).not.toThrow();
  });

  it("rejects when team member belongs to wrong team", () => {
    expect(() => assertAllMembersBelongToTeam(["1", "2", "3"], ["1", "2"])).toThrow("队员不属于本队");
  });

  it("rejects when less than 2h before match", () => {
    const now = new Date("2026-01-01T10:00:00Z");
    const scheduledAt = new Date("2026-01-01T11:59:00Z");
    expect(() => assertRosterSubmissionOpen(scheduledAt, now)).toThrow("距开赛不足 2 小时");
  });
});

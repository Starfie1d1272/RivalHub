import { describe, expect, it } from "vitest";
import { AppError, ErrorCode } from "@/lib/errors";
import { frozenStageRunAffiliationRules } from "./frozen-affiliation-rules";

describe("frozenStageRunAffiliationRules", () => {
  it("reads an immutable StageRun rule rather than a mutable season capability", () => {
    const rules = frozenStageRunAffiliationRules({
      affiliationRules: [{
        institutionCode: "4132010284",
        eligibleAcademicStatuses: ["enrolled", "graduated"],
        minRosterMembers: 3,
        minStartingMembers: 3,
      }],
    });
    expect(rules).toEqual([{
      institutionCode: "4132010284",
      eligibleAcademicStatuses: ["enrolled", "graduated"],
      minRosterMembers: 3,
      minStartingMembers: 3,
    }]);
  });

  it("fails closed when an old or malformed StageRun has no affiliation snapshot", () => {
    expect(() => frozenStageRunAffiliationRules({ version: 1 })).toThrowError(AppError);
    try {
      frozenStageRunAffiliationRules({ version: 1 });
    } catch (error) {
      expect((error as AppError).code).toBe(ErrorCode.INTERNAL_ERROR);
    }
  });
});

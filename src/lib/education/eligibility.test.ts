import { describe, expect, it } from "vitest";
import type { InstitutionAffiliationRule } from "@/types/season";
import { evaluateRosterEducationEligibility, type EducationEligibilityMember } from "./eligibility";

const institutionCode = "4132010284";
const rules: InstitutionAffiliationRule[] = [
  { institutionCode, eligibleAcademicStatuses: ["enrolled", "graduated"], minRosterMembers: 2, minStartingMembers: 0 },
  { institutionCode, eligibleAcademicStatuses: ["enrolled"], minRosterMembers: 1, minStartingMembers: 0 },
];

function member(userId: string, academicStatus: "enrolled" | "graduated"): EducationEligibilityMember {
  return {
    userId,
    label: userId,
    emailVerifiedAt: new Date(0),
    verification: { id: userId, institutionCode, institutionName: "南京大学", academicStatus, status: "approved" },
  };
}

describe("roster affiliation minimums", () => {
  it("counts each selected verification for every applicable rule regardless of rule order", () => {
    const roster = [member("student", "enrolled"), member("alumna", "graduated")];
    for (const order of [rules, [...rules].reverse()]) {
      const result = evaluateRosterEducationEligibility(roster, order);
      expect(result.eligible).toBe(true);
      expect(result.affiliationCounts.get(institutionCode)).toBe(2);
    }
  });

  it("requires the narrower minimum to be met independently", () => {
    const roster = [member("alum1", "graduated"), member("alum2", "graduated")];
    expect(evaluateRosterEducationEligibility(roster, rules).eligible).toBe(false);
  });
});

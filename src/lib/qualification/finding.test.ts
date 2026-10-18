import { describe, expect, it } from "vitest";
import { qualificationFindingCoveredByApproval, type QualificationFinding } from "./finding";

const finding = (external: number, home = 28, limit = 3): QualificationFinding => ({
  code: "external_strength_gap", message: "strength gap", waivable: true,
  metadata: { strongestExternalStars: external, strongestHomeStars: home, externalStrengthMaxStarGap: limit },
});

describe("approved external strength limits", () => {
  it("retains an approval when corrected profile data reduces the gap", () => {
    expect(qualificationFindingCoveredByApproval(finding(37), finding(33))).toBe(true);
    expect(qualificationFindingCoveredByApproval(finding(37), finding(37))).toBe(true);
    expect(qualificationFindingCoveredByApproval(finding(37), finding(37, 30))).toBe(true);
  });

  it("requires review for a larger gap, changed rule or invalid evidence", () => {
    expect(qualificationFindingCoveredByApproval(finding(37), finding(38))).toBe(false);
    expect(qualificationFindingCoveredByApproval(finding(37), finding(37, 27))).toBe(false);
    expect(qualificationFindingCoveredByApproval(finding(37), finding(33, 28, 2))).toBe(false);
    expect(qualificationFindingCoveredByApproval(null, finding(33))).toBe(false);
    expect(qualificationFindingCoveredByApproval(finding(Number.NaN), finding(33))).toBe(false);
    expect(qualificationFindingCoveredByApproval({ ...finding(37), waivable: false }, finding(33))).toBe(false);
  });
});

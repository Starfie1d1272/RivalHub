import { describe, expect, it } from "vitest";
import { presentPublicEducationIdentities, type EducationVerificationForPublicPresentation } from "@/lib/education/presentation";

const baseClaim = (
  overrides: Partial<EducationVerificationForPublicPresentation> = {},
): EducationVerificationForPublicPresentation => ({
  id: "claim-1",
  institutionId: "institution-nju",
  institutionName: "南京大学",
  academicStatus: "enrolled",
  status: "approved",
  submittedAt: new Date("2026-08-01T00:00:00Z"),
  ...overrides,
});

describe("public education presentation", () => {
  it("presents an approved institution and academic status", () => {
    expect(presentPublicEducationIdentities([baseClaim()])).toEqual([
      { institutionName: "南京大学", academicStatus: "在读", verificationLabel: "已认证" },
    ]);
  });

  it("does not expose pending or rejected claims", () => {
    expect(presentPublicEducationIdentities([
      baseClaim({ id: "pending", status: "pending" }),
      baseClaim({ id: "rejected", status: "rejected" }),
    ])).toEqual([]);
  });

  it("deduplicates an institution and uses the latest approved claim", () => {
    expect(presentPublicEducationIdentities([
      baseClaim({ id: "older", academicStatus: "enrolled", submittedAt: new Date("2026-08-01T00:00:00Z") }),
      baseClaim({ id: "newer", academicStatus: "graduated", submittedAt: new Date("2026-08-02T00:00:00Z") }),
    ])).toEqual([
      { institutionName: "南京大学", academicStatus: "已毕业", verificationLabel: "已认证" },
    ]);
  });

  it("does not let a newer pending claim override approved history", () => {
    expect(presentPublicEducationIdentities([
      baseClaim({ id: "approved", academicStatus: "enrolled", submittedAt: new Date("2026-08-01T00:00:00Z") }),
      baseClaim({ id: "pending", academicStatus: "graduated", status: "pending", submittedAt: new Date("2026-08-02T00:00:00Z") }),
    ])).toEqual([
      { institutionName: "南京大学", academicStatus: "在读", verificationLabel: "已认证" },
    ]);
  });

  it("returns only the public DTO fields even when input resembles a persisted row", () => {
    const persistedLike = {
      ...baseClaim(),
      evidenceCode: "ABCD1234EFGH5678",
      evidenceType: "chsi_enrollment_report",
      reviewedBy: "admin-secret",
      reviewNote: "internal note",
    };

    const [identity] = presentPublicEducationIdentities([persistedLike]);

    expect(Object.keys(identity)).toEqual(["institutionName", "academicStatus", "verificationLabel"]);
    expect(identity).not.toHaveProperty("evidenceCode");
    expect(identity).not.toHaveProperty("evidenceType");
    expect(identity).not.toHaveProperty("reviewNote");
    expect(identity).not.toHaveProperty("reviewedBy");
  });
});

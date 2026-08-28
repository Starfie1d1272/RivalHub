import { describe, expect, it } from "vitest";
import { declareInstitutionalEmailEducation, reviewEducationVerification, submitEducationVerification } from "@/actions/education-verifications";
import { ErrorCode } from "@/lib/errors";

describe("education verification action validation", () => {
  it("fails closed for malformed CHSI submission before database access", async () => {
    const result = await submitEducationVerification({ institutionId: "not-a-uuid", academicStatus: "enrolled", evidenceType: "chsi_enrollment_report", evidenceUrl: "https://evil.example" });
    expect(result).toMatchObject({ success: false, error: { code: ErrorCode.VALIDATION_FAILED } });
  });

  it("fails closed for invalid institutional status and review input", async () => {
    await expect(declareInstitutionalEmailEducation({ academicStatus: "other" as never })).resolves.toMatchObject({ success: false, error: { code: ErrorCode.VALIDATION_FAILED } });
    await expect(reviewEducationVerification({ id: "not-a-uuid", decision: "approved" })).resolves.toMatchObject({ success: false, error: { code: ErrorCode.VALIDATION_FAILED } });
  });
});

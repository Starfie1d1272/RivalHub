import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, ErrorCode } from "@/lib/errors";

const {
  requireAuthMock,
  requireSuperAdminMock,
  manualCommandMock,
  signedUrlMock,
  verificationFindFirstMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  requireSuperAdminMock: vi.fn(),
  manualCommandMock: vi.fn(),
  signedUrlMock: vi.fn(),
  verificationFindFirstMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireAuth: requireAuthMock,
  requireSuperAdmin: requireSuperAdminMock,
  auditActorId: vi.fn(() => "user-1"),
}));
vi.mock("@/lib/education/commands", () => ({
  submitAdmissionNoticeEducationCommand: manualCommandMock,
  submitChsiEducationVerification: vi.fn(),
}));
vi.mock("@/lib/education/storage", () => ({
  educationEvidenceStorage: { createSignedUrl: signedUrlMock },
}));
vi.mock("@/db/client", () => ({
  db: {
    query: { educationVerifications: { findFirst: verificationFindFirstMock } },
    select: vi.fn(),
    transaction: vi.fn(),
  },
}));

import {
  getEducationManualEvidenceUrl,
  submitAdmissionNoticeEducation,
} from "@/actions/education-verifications";

const SESSION = { userId: "00000000-0000-4000-8000-000000000001", email: "player@example.test" };
const INSTITUTION_ID = "00000000-0000-4000-8000-000000000002";
const VERIFICATION_ID = "00000000-0000-4000-8000-000000000003";

function manualForm(): FormData {
  const form = new FormData();
  form.set("institutionId", INSTITUTION_ID);
  form.set("file", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "notice.pdf", { type: "image/png" }));
  return form;
}

describe("manual education evidence actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue(SESSION);
    manualCommandMock.mockResolvedValue("created");
    requireSuperAdminMock.mockResolvedValue({ ...SESSION, role: "super_admin", seasonIds: [] });
    verificationFindFirstMock.mockResolvedValue({ evidenceType: "manual_other", evidenceObjectKey: `${VERIFICATION_ID}/object.png` });
    signedUrlMock.mockResolvedValue("https://storage.test/signed");
  });

  it("passes only the validated institution and file to the server workflow", async () => {
    const form = manualForm();

    await expect(submitAdmissionNoticeEducation(form)).resolves.toEqual({ success: true, data: "created" });

    expect(manualCommandMock).toHaveBeenCalledWith({
      session: SESSION,
      institutionId: INSTITUTION_ID,
      file: expect.objectContaining({ mimeType: "image/png", extension: "png" }),
    });
    const submittedFile = manualCommandMock.mock.calls[0]?.[0]?.file?.file as File;
    expect(submittedFile.name).toBe("notice.pdf");
  });

  it("requires super-admin authorization before looking up or signing manual evidence", async () => {
    requireSuperAdminMock.mockRejectedValue(new AppError(ErrorCode.FORBIDDEN, "权限不足"));

    await expect(getEducationManualEvidenceUrl({ id: VERIFICATION_ID })).resolves.toMatchObject({
      success: false,
      error: { code: ErrorCode.FORBIDDEN },
    });

    expect(verificationFindFirstMock).not.toHaveBeenCalled();
    expect(signedUrlMock).not.toHaveBeenCalled();
  });

  it("fails closed when the row is not a live manual object", async () => {
    verificationFindFirstMock.mockResolvedValue({ evidenceType: "manual_other", evidenceObjectKey: null });

    await expect(getEducationManualEvidenceUrl({ id: VERIFICATION_ID })).resolves.toMatchObject({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED },
    });
    expect(signedUrlMock).not.toHaveBeenCalled();
  });

  it("returns only the adapter's short-lived signed URL", async () => {
    await expect(getEducationManualEvidenceUrl({ id: VERIFICATION_ID })).resolves.toEqual({ success: true, data: "https://storage.test/signed" });
    expect(signedUrlMock).toHaveBeenCalledWith(`${VERIFICATION_ID}/object.png`);
  });
});

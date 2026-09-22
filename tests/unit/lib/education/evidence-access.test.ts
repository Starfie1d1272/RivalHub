import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, ErrorCode } from "@/lib/errors";

const {
  requireSuperAdminMock,
  signedUrlMock,
  verificationFindFirstMock,
} = vi.hoisted(() => ({
  requireSuperAdminMock: vi.fn(),
  signedUrlMock: vi.fn(),
  verificationFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireSuperAdmin: requireSuperAdminMock }));
vi.mock("@/lib/education/storage", () => ({ educationEvidenceStorage: { createSignedUrl: signedUrlMock } }));
vi.mock("@/db/client", () => ({ db: { query: { educationVerifications: { findFirst: verificationFindFirstMock } } } }));

import { getManualEducationEvidenceSignedUrl } from "@/lib/education/evidence-access";

const VERIFICATION_ID = "00000000-0000-4000-8000-000000000003";

describe("manual education evidence access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSuperAdminMock.mockResolvedValue({ userId: "admin-1", role: "super_admin", seasonIds: [] });
    verificationFindFirstMock.mockResolvedValue({ evidenceType: "manual_other", evidenceObjectKey: `${VERIFICATION_ID}/object.png` });
    signedUrlMock.mockResolvedValue("https://storage.test/signed");
  });

  it("requires super-admin authorization before looking up or signing manual evidence", async () => {
    requireSuperAdminMock.mockRejectedValue(new AppError(ErrorCode.FORBIDDEN, "权限不足"));

    await expect(getManualEducationEvidenceSignedUrl({ id: VERIFICATION_ID })).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });

    expect(verificationFindFirstMock).not.toHaveBeenCalled();
    expect(signedUrlMock).not.toHaveBeenCalled();
  });

  it("fails closed when the row is not a live manual object", async () => {
    verificationFindFirstMock.mockResolvedValue({ evidenceType: "manual_other", evidenceObjectKey: null });

    await expect(getManualEducationEvidenceSignedUrl({ id: VERIFICATION_ID })).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    expect(signedUrlMock).not.toHaveBeenCalled();
  });

  it("returns only the adapter's short-lived signed URL", async () => {
    await expect(getManualEducationEvidenceSignedUrl({ id: VERIFICATION_ID })).resolves.toBe("https://storage.test/signed");
    expect(signedUrlMock).toHaveBeenCalledWith(`${VERIFICATION_ID}/object.png`);
  });
});

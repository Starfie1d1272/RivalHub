import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, ErrorCode } from "@/lib/errors";

const signedUrlMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/education/evidence-access", () => ({ getManualEducationEvidenceSignedUrl: signedUrlMock }));

import { GET } from "@/app/admin/education-verifications/[id]/evidence/route";

const VERIFICATION_ID = "00000000-0000-4000-8000-000000000003";

describe("admin education evidence route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signedUrlMock.mockResolvedValue("https://storage.test/signed");
  });

  it("redirects a normal browser navigation to the short-lived signed URL", async () => {
    const response = await GET(
      new Request(`https://rivalhub.test/admin/education-verifications/${VERIFICATION_ID}/evidence`),
      { params: Promise.resolve({ id: VERIFICATION_ID }) },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://storage.test/signed");
    expect(signedUrlMock).toHaveBeenCalledWith({ id: VERIFICATION_ID });
  });

  it("does not reveal a signed URL when the super-admin guard rejects the request", async () => {
    signedUrlMock.mockRejectedValue(new AppError(ErrorCode.FORBIDDEN, "权限不足"));

    const response = await GET(
      new Request(`https://rivalhub.test/admin/education-verifications/${VERIFICATION_ID}/evidence`),
      { params: Promise.resolve({ id: VERIFICATION_ID }) },
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("location")).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";

const { requireAuthMock, userFindFirstMock, institutionFindFirstMock, transactionMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  institutionFindFirstMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuth: requireAuthMock,
  requireSuperAdmin: vi.fn(),
  auditActorId: vi.fn(() => "user-1"),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/db/client", () => ({
  db: {
    query: {
      users: { findFirst: userFindFirstMock },
      institutions: { findFirst: institutionFindFirstMock },
    },
    transaction: transactionMock,
  },
}));

import { submitEducationVerification } from "@/actions/education-verifications";

describe("submitEducationVerification email ownership boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ userId: "00000000-0000-0000-0000-000000000001", email: "player@example.test" });
  });

  it("rejects an unverified authenticated account before any institution lookup or write", async () => {
    userFindFirstMock.mockResolvedValue({ id: "00000000-0000-0000-0000-000000000001", emailVerifiedAt: null });

    const result = await submitEducationVerification({
      institutionId: "00000000-0000-0000-0000-000000000002",
      academicStatus: "enrolled",
      evidenceType: "chsi_enrollment_report",
      evidenceUrl: "https://www.chsi.com.cn/xlcx/bgys.jsp",
    });

    expect(result).toMatchObject({ success: false, error: { code: ErrorCode.FORBIDDEN } });
    expect(institutionFindFirstMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

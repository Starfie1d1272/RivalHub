import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";

const { requireAuthMock, requireSuperAdminMock, userFindFirstMock, institutionFindFirstMock, transactionMock, reviewFindFirstMock, updateSetMock, updateWhereMock, insertValuesMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  requireSuperAdminMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  institutionFindFirstMock: vi.fn(),
  transactionMock: vi.fn(),
  reviewFindFirstMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  insertValuesMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuth: requireAuthMock,
  requireSuperAdmin: requireSuperAdminMock,
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

import { reviewEducationVerification, submitEducationVerification } from "@/actions/education-verifications";

const REVIEW_ID = "00000000-0000-0000-0000-000000000003";

describe("submitEducationVerification email ownership boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ userId: "00000000-0000-0000-0000-000000000001", email: "player@example.test" });
    reviewFindFirstMock.mockResolvedValue({ id: REVIEW_ID, status: "pending" });
    updateSetMock.mockReturnValue({ where: updateWhereMock });
    updateWhereMock.mockResolvedValue([]);
    insertValuesMock.mockResolvedValue([]);
    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      query: { educationVerifications: { findFirst: reviewFindFirstMock } },
      update: vi.fn(() => ({ set: updateSetMock })),
      insert: vi.fn(() => ({ values: insertValuesMock })),
    }));
  });

  it("rejects an unverified authenticated account before any institution lookup or write", async () => {
    userFindFirstMock.mockResolvedValue({ id: "00000000-0000-0000-0000-000000000001", emailVerifiedAt: null });

    const result = await submitEducationVerification({
      institutionId: "00000000-0000-0000-0000-000000000002",
      academicStatus: "enrolled",
      evidenceCode: "ABCD1234EFGH5678",
    });

    expect(result).toMatchObject({ success: false, error: { code: ErrorCode.FORBIDDEN } });
    expect(institutionFindFirstMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("allows an approved review with a blank optional note after server validation", async () => {
    requireSuperAdminMock.mockResolvedValue({ userId: "00000000-0000-0000-0000-000000000004", email: "admin@example.test", role: "super_admin", seasonIds: [] });

    const result = await reviewEducationVerification({ id: REVIEW_ID, decision: "approved", reviewNote: " \t " });

    expect(result).toEqual({ success: true, data: undefined });
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({ status: "approved", reviewNote: null }));
  });
});

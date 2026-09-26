import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";

const { requireAuthMock, requireSuperAdminMock, userFindFirstMock, institutionFindFirstMock, transactionMock, reviewFindFirstMock, updateSetMock, updateWhereMock, insertValuesMock, selectMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  requireSuperAdminMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  institutionFindFirstMock: vi.fn(),
  transactionMock: vi.fn(),
  reviewFindFirstMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  insertValuesMock: vi.fn(),
  selectMock: vi.fn(),
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
    select: selectMock,
  },
}));

import { createManualInstitution, reviewEducationVerification, submitEducationVerification } from "@/actions/education-verifications";

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
    selectMock.mockReturnValue({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) });
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

  it("refuses to approve a pending manual claim without its evidence object", async () => {
    requireSuperAdminMock.mockResolvedValue({ userId: "00000000-0000-0000-0000-000000000004", email: "admin@example.test", role: "super_admin", seasonIds: [] });
    reviewFindFirstMock.mockResolvedValue({ id: REVIEW_ID, status: "pending", evidenceType: "manual_other", evidenceObjectKey: null });

    const result = await reviewEducationVerification({ id: REVIEW_ID, decision: "approved" });

    expect(result).toMatchObject({ success: false, error: { code: ErrorCode.VALIDATION_FAILED } });
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("reuses a case-insensitive exact institution match instead of inserting a duplicate", async () => {
    requireSuperAdminMock.mockResolvedValue({ userId: "00000000-0000-0000-0000-000000000004", email: "admin@example.test", role: "super_admin", seasonIds: [] });
    const insert = vi.fn();
    transactionMock.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([{ id: "institution-1", name: "南京大学", province: "江苏" }])),
          })),
        })),
      })),
      insert,
    }));

    const result = await createManualInstitution({ name: "  南京大学  ", province: "江苏" });

    expect(result).toEqual({
      success: true,
      data: { institution: { id: "institution-1", name: "南京大学", province: "江苏" }, reused: true },
    });
    expect(requireSuperAdminMock).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
  });

  it("creates a manual canonical institution and writes its audit fact in the same transaction", async () => {
    requireSuperAdminMock.mockResolvedValue({ userId: "00000000-0000-0000-0000-000000000004", email: "admin@example.test", role: "super_admin", seasonIds: [] });
    const created = { id: "institution-2", name: "测试大学", province: "江苏" };
    const institutionValues = vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([created])) }));
    const auditValues = vi.fn(() => Promise.resolve([]));
    const insert = vi.fn()
      .mockReturnValueOnce({ values: institutionValues })
      .mockReturnValueOnce({ values: auditValues });
    transactionMock.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      })),
      insert,
    }));

    const result = await createManualInstitution({ name: " 测试大学 ", province: " 江苏 " });

    expect(result).toEqual({ success: true, data: { institution: created, reused: false } });
    expect(institutionValues).toHaveBeenCalledWith(expect.objectContaining({
      name: "测试大学",
      province: "江苏",
      moeInstitutionCode: null,
      source: "manual",
      sourceVersion: "manual",
    }));
    expect(auditValues).toHaveBeenCalledTimes(1);
  });
});

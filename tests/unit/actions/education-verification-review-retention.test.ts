import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireSuperAdminMock,
  verificationFindFirstMock,
  transactionMock,
  txUpdateMock,
  txInsertMock,
  updateSetCalls,
  insertValuesCalls,
  revalidatePathMock,
} = vi.hoisted(() => ({
  requireSuperAdminMock: vi.fn(),
  verificationFindFirstMock: vi.fn(),
  transactionMock: vi.fn(),
  txUpdateMock: vi.fn(),
  txInsertMock: vi.fn(),
  updateSetCalls: [] as unknown[],
  insertValuesCalls: [] as unknown[],
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuth: vi.fn(),
  requireSuperAdmin: requireSuperAdminMock,
  auditActorId: (session: { userId: string }) => session.userId,
}));
vi.mock("@/db/client", () => ({ db: { transaction: transactionMock } }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { reviewEducationVerification } from "@/actions/education-verifications";

const verificationId = "11111111-1111-4111-8111-111111111111";
const evidenceCode = "ABCD1234EFGH5678";

beforeEach(() => {
  vi.clearAllMocks();
  updateSetCalls.length = 0;
  insertValuesCalls.length = 0;
  requireSuperAdminMock.mockResolvedValue({ userId: "admin-1", email: "admin@example.test", role: "super_admin", seasonIds: [] });
  verificationFindFirstMock.mockResolvedValue({ id: verificationId, status: "pending", evidenceCode });
  txUpdateMock.mockReturnValue({
    set: vi.fn((values: unknown) => {
      updateSetCalls.push(values);
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
  });
  txInsertMock.mockReturnValue({
    values: vi.fn((values: unknown) => {
      insertValuesCalls.push(values);
      return Promise.resolve();
    }),
  });
  transactionMock.mockImplementation((callback: (tx: unknown) => unknown) => callback({
    query: { educationVerifications: { findFirst: verificationFindFirstMock } },
    update: txUpdateMock,
    insert: txInsertMock,
  }));
});

describe("education verification review retention boundary", () => {
  it("does not clear the code at review time or copy it into audit metadata", async () => {
    const result = await reviewEducationVerification({ id: verificationId, decision: "approved", reviewNote: "人工核验通过" });

    expect(result).toMatchObject({ success: true });
    expect(updateSetCalls[0]).toMatchObject({ status: "approved", reviewedBy: "admin-1", reviewNote: "人工核验通过" });
    expect(updateSetCalls[0]).not.toHaveProperty("evidenceCode");
    expect(JSON.stringify(insertValuesCalls)).not.toContain(evidenceCode);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";

const {
  verifyOtpMock,
  createUserSessionMock,
  dbTransactionMock,
  dbInsertMock,
  dbUpdateMock,
  insertValuesMock,
  updateSetMock,
  normalizeEmailMock,
  bootstrapConfiguredOwnerInTxMock,
} = vi.hoisted(() => ({
  verifyOtpMock: vi.fn(),
  createUserSessionMock: vi.fn(),
  dbTransactionMock: vi.fn(),
  dbInsertMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  insertValuesMock: vi.fn(),
  updateSetMock: vi.fn(),
  normalizeEmailMock: vi.fn((email: string) => email),
  bootstrapConfiguredOwnerInTxMock: vi.fn(),
}));

vi.mock("@/lib/auth/supabase-server", () => ({
  createPublicAuthClient: () => ({ auth: { verifyOtp: verifyOtpMock } }),
}));
vi.mock("@/lib/auth/session", () => ({ createUserSession: createUserSessionMock }));
vi.mock("@/lib/utils/email", () => ({ normalizeEmail: normalizeEmailMock }));
vi.mock("@/lib/auth/owner-bootstrap", () => ({
  bootstrapConfiguredOwnerInTx: bootstrapConfiguredOwnerInTxMock,
}));
vi.mock("@/db/client", () => ({ db: { transaction: dbTransactionMock } }));

import { confirmEmailVerification } from "@/actions/auth-confirmation";

const userRow = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "player@example.test",
  role: "user",
};

function configureDb(): void {
  dbInsertMock.mockReturnValue({
    values: insertValuesMock.mockReturnValue({
      onConflictDoUpdate: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([userRow]) }),
    }),
  });
  dbUpdateMock.mockReturnValue({
    set: updateSetMock.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  });
  dbTransactionMock.mockImplementation((callback: (tx: unknown) => unknown) =>
    callback({ insert: dbInsertMock, update: dbUpdateMock }),
  );
  bootstrapConfiguredOwnerInTxMock.mockImplementation((_: unknown, user: unknown) => user);
}

function confirmedUser() {
  return {
    error: null,
    data: {
      user: {
        id: "auth-user-1",
        email: userRow.email,
        email_confirmed_at: "2026-09-01T00:00:00.000Z",
      },
    },
  };
}

describe("confirmEmailVerification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    normalizeEmailMock.mockImplementation((email: string) => email);
    configureDb();
  });

  it("显式 signup POST 才验证 token、同步事实、建立 session，并安全跳转", async () => {
    verifyOtpMock.mockResolvedValue(confirmedUser());

    const result = await confirmEmailVerification("signup", "signup-token", "/seasons/current");

    expect(result).toEqual({ success: true, data: { redirectTo: "/seasons/current" } });
    expect(verifyOtpMock).toHaveBeenCalledWith({ token_hash: "signup-token", type: "email" });
    expect(insertValuesMock).toHaveBeenCalledWith({ email: userRow.email, authId: "auth-user-1" });
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      emailVerificationSource: "signup_confirmation",
      emailVerifiedAt: expect.any(Date),
    }));
    expect(createUserSessionMock).toHaveBeenCalledWith({ userId: userRow.id, email: userRow.email });
  });

  it("reverify 也通过显式 POST 验证，并使用它自己的默认跳转", async () => {
    verifyOtpMock.mockResolvedValue(confirmedUser());

    const result = await confirmEmailVerification("reverify", "reverify-token");

    expect(result).toEqual({ success: true, data: { redirectTo: "/settings/education" } });
    expect(verifyOtpMock).toHaveBeenCalledWith({ token_hash: "reverify-token", type: "magiclink" });
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      emailVerificationSource: "existing_account_reverification",
    }));
  });

  it("缺失、非法或过期 token 返回可操作失败，且不写入 DB 或 session", async () => {
    const missing = await confirmEmailVerification("signup", "");
    verifyOtpMock.mockResolvedValue({ error: { message: "expired" }, data: { user: null } });
    const expired = await confirmEmailVerification("signup", "expired-token");

    expect(missing).toMatchObject({ success: false, error: { code: ErrorCode.VALIDATION_FAILED } });
    expect(expired).toMatchObject({ success: false, error: { code: ErrorCode.VALIDATION_FAILED } });
    expect(verifyOtpMock).toHaveBeenCalledOnce();
    expect(dbTransactionMock).not.toHaveBeenCalled();
    expect(createUserSessionMock).not.toHaveBeenCalled();
  });

  it("POST 成功后仍拒绝外站 next", async () => {
    verifyOtpMock.mockResolvedValue(confirmedUser());

    await expect(confirmEmailVerification("signup", "token", "https://evil.example")).resolves.toEqual({
      success: true,
      data: { redirectTo: "/" },
    });
  });

  it("已消费 token 的第二次 POST 不重复创建验证事实或 session", async () => {
    verifyOtpMock
      .mockResolvedValueOnce(confirmedUser())
      .mockResolvedValueOnce({ error: { message: "already used" }, data: { user: null } });

    const first = await confirmEmailVerification("signup", "single-use-token");
    const second = await confirmEmailVerification("signup", "single-use-token");

    expect(first.success).toBe(true);
    expect(second).toMatchObject({ success: false, error: { code: ErrorCode.VALIDATION_FAILED } });
    expect(dbTransactionMock).toHaveBeenCalledOnce();
    expect(updateSetMock).toHaveBeenCalledOnce();
    expect(createUserSessionMock).toHaveBeenCalledOnce();
  });
});

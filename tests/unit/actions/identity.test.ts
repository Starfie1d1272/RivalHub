import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";

const {
  verifyOtpMock,
  requireAuthMock,
  dbTransactionMock,
  completeSecondaryIdentityLinkInTxMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  verifyOtpMock: vi.fn(),
  requireAuthMock: vi.fn(),
  dbTransactionMock: vi.fn(),
  completeSecondaryIdentityLinkInTxMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/auth/supabase-server", () => ({
  createPublicAuthClient: () => ({ auth: { verifyOtp: verifyOtpMock } }),
}));
vi.mock("@/lib/auth/session", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/identity/linking", () => ({
  completeSecondaryIdentityLinkInTx: completeSecondaryIdentityLinkInTxMock,
  hashIdentityLinkState: vi.fn(),
  revokeSecondaryEmailIdentityInTx: vi.fn(),
}));
vi.mock("@/db/client", () => ({ db: { transaction: dbTransactionMock } }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { confirmSecondaryEmailIdentity } from "@/actions/identity";

const requestId = "11111111-1111-4111-8111-111111111111";
const session = { userId: "22222222-2222-4222-8222-222222222222" };

function confirmedUser() {
  return {
    data: {
      user: {
        id: "33333333-3333-4333-8333-333333333333",
        email: "secondary@example.test",
        email_confirmed_at: "2026-09-08T03:05:00.000Z",
      },
    },
    error: null,
  };
}

function input(otpType: string) {
  return { requestId, stateToken: "a-state-token-with-at-least-twenty-characters", tokenHash: "opaque-token", otpType };
}

describe("confirmSecondaryEmailIdentity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue(session);
    dbTransactionMock.mockImplementation((callback: (tx: unknown) => unknown) => callback("tx"));
    completeSecondaryIdentityLinkInTxMock.mockResolvedValue({ kind: "linked" });
  });

  it("以 confirmation_token 的 email 类型验证并直接绑定第二邮箱", async () => {
    verifyOtpMock.mockResolvedValue(confirmedUser());

    await expect(confirmSecondaryEmailIdentity(input("email"))).resolves.toEqual({
      success: true,
      data: { kind: "linked", redirectTo: "/settings/education" },
    });
    expect(verifyOtpMock).toHaveBeenCalledWith({ token_hash: "opaque-token", type: "email" });
    expect(completeSecondaryIdentityLinkInTxMock).toHaveBeenCalledWith("tx", expect.objectContaining({
      requestId,
      currentUserId: session.userId,
      authId: "33333333-3333-4333-8333-333333333333",
      email: "secondary@example.test",
    }));
  });

  it("保留已确认邮箱的 magiclink proof，并继续进入归并预检", async () => {
    verifyOtpMock.mockResolvedValue(confirmedUser());
    completeSecondaryIdentityLinkInTxMock.mockResolvedValue({
      kind: "merge_required",
      authorizationId: "44444444-4444-4444-8444-444444444444",
    });

    await expect(confirmSecondaryEmailIdentity(input("magiclink"))).resolves.toEqual({
      success: true,
      data: {
        kind: "merge_required",
        authorizationId: "44444444-4444-4444-8444-444444444444",
        redirectTo: "/settings/security/merge?authorization=44444444-4444-4444-8444-444444444444",
      },
    });
    expect(verifyOtpMock).toHaveBeenCalledWith({ token_hash: "opaque-token", type: "magiclink" });
  });

  it("对篡改的 OTP 类型 fail closed，且不调用 provider 或完成绑定请求", async () => {
    await expect(confirmSecondaryEmailIdentity(input("recovery"))).resolves.toMatchObject({
      success: false,
      error: { code: ErrorCode.VALIDATION_FAILED },
    });

    expect(verifyOtpMock).not.toHaveBeenCalled();
    expect(dbTransactionMock).not.toHaveBeenCalled();
    expect(completeSecondaryIdentityLinkInTxMock).not.toHaveBeenCalled();
  });

  it("provider proof 失败时不消费绑定请求，并给出可恢复的准确提示", async () => {
    verifyOtpMock.mockResolvedValue({ data: { user: null }, error: { message: "expired" } });

    await expect(confirmSecondaryEmailIdentity(input("email"))).resolves.toEqual({
      success: false,
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: "无法验证这个邮箱绑定链接。链接可能已过期、已完成验证或验证信息不匹配，请重新发起绑定。",
      },
    });

    expect(dbTransactionMock).not.toHaveBeenCalled();
    expect(completeSecondaryIdentityLinkInTxMock).not.toHaveBeenCalled();
  });
});

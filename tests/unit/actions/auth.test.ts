import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";
import { mockUserSession } from "tests/helpers";

// ── hoisted mocks ─────────────────────────────────────────────────────────
const {
  requireAuthMock,
  createUserSessionMock,
  destroyUserSessionMock,
  claimAdminInviteInTxMock,
  signInWithPasswordMock,
  resetPasswordForEmailMock,
  signUpMock,
  revalidatePathMock,
  normalizeEmailMock,
  dbInsertMock,
  dbTransactionMock,
  bootstrapConfiguredOwnerInTxMock,
} = vi.hoisted(() => {
  return {
    requireAuthMock: vi.fn(),
    createUserSessionMock: vi.fn(),
    destroyUserSessionMock: vi.fn(),
    claimAdminInviteInTxMock: vi.fn(),
    signInWithPasswordMock: vi.fn(),
    resetPasswordForEmailMock: vi.fn(),
    signUpMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    normalizeEmailMock: vi.fn((email: string) => email),
    dbInsertMock: vi.fn(),
    dbTransactionMock: vi.fn(),
    bootstrapConfiguredOwnerInTxMock: vi.fn(),
  };
});

vi.mock("@/lib/auth/session", () => ({
  requireAuth: requireAuthMock,
  createUserSession: createUserSessionMock,
  destroyUserSession: destroyUserSessionMock,
}));

vi.mock("@/lib/auth/admin-invites", () => ({
  claimAdminInviteInTx: claimAdminInviteInTxMock,
}));

vi.mock("@/lib/auth/supabase", () => ({
  createServiceClient: () => ({
    auth: {
      signInWithPassword: signInWithPasswordMock,
      resetPasswordForEmail: resetPasswordForEmailMock,
      signUp: signUpMock,
    },
  }),
  createPublicAuthClient: () => ({ auth: { signUp: signUpMock } }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/lib/utils/email", () => ({
  normalizeEmail: normalizeEmailMock,
}));

vi.mock("@/lib/auth/owner-bootstrap", () => ({
  bootstrapConfiguredOwnerInTx: bootstrapConfiguredOwnerInTxMock,
}));

vi.mock("@/db/client", () => {
  return {
    db: {
      insert: dbInsertMock,
      transaction: dbTransactionMock.mockImplementation((callback: (tx: unknown) => unknown) => callback("tx")),
    },
  };
});

import { loginWithPassword, signUp, sendPasswordResetEmail, logoutUser, claimInviteCode } from "@/actions/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/config/auth-config";

// ── helpers ───────────────────────────────────────────────────────────────

/** 构造 db.insert(...).values(...).onConflictDoUpdate(...).returning() 链 */
function makeInsertChain(returnValue: unknown[]) {
  const chain = {
    values: vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(returnValue),
      }),
    }),
  };
  dbInsertMock.mockReturnValue(chain);
  return dbInsertMock;
}

const SHORT_PASSWORD = "x".repeat(MIN_PASSWORD_LENGTH - 1);
const VALID_PASSWORD = "Aa1!xx";
const VALID_EMAIL = "test@example.com";

const MOCK_USER_ROW = {
  id: "user-1",
  email: VALID_EMAIL,
  role: "user" as const,
};

// ── loginWithPassword ─────────────────────────────────────────────────────

describe("loginWithPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbTransactionMock.mockImplementation((callback: (tx: unknown) => unknown) => callback({ insert: dbInsertMock }));
    normalizeEmailMock.mockImplementation((e: string) => e);
    bootstrapConfiguredOwnerInTxMock.mockImplementation((_: unknown, user: unknown) => user);
    delete process.env.RIVALHUB_OWNER_EMAIL;
  });

  it("空邮箱返回 VALIDATION_FAILED", async () => {
    const result = await loginWithPassword("", VALID_PASSWORD);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it("不含 @ 的邮箱返回 VALIDATION_FAILED", async () => {
    const result = await loginWithPassword("notanemail", VALID_PASSWORD);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it(`密码长度不足 ${MIN_PASSWORD_LENGTH} 位返回 VALIDATION_FAILED`, async () => {
    const result = await loginWithPassword(VALID_EMAIL, SHORT_PASSWORD);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it("Supabase signInWithPassword 失败返回 UNAUTHORIZED", async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: null,
      error: { message: "Invalid credentials" },
    });

    const result = await loginWithPassword(VALID_EMAIL, VALID_PASSWORD);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.UNAUTHORIZED);
    }
  });

  it("正常登录：upsert user + createUserSession + 返回 email", async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: { user: { id: "auth-uuid-1" } },
      error: null,
    });
    makeInsertChain([MOCK_USER_ROW]);
    createUserSessionMock.mockResolvedValue(undefined);

    const result = await loginWithPassword(VALID_EMAIL, VALID_PASSWORD);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe(VALID_EMAIL);
    }
    expect(createUserSessionMock).toHaveBeenCalledWith({
      userId: MOCK_USER_ROW.id,
      email: MOCK_USER_ROW.email,
    });
  });

  it("在登录事务中把已认证用户交给 owner bootstrap", async () => {
    process.env.RIVALHUB_OWNER_EMAIL = VALID_EMAIL;
    signInWithPasswordMock.mockResolvedValue({
      data: { user: { id: "auth-uuid-owner" } },
      error: null,
    });
    makeInsertChain([MOCK_USER_ROW]);

    const result = await loginWithPassword(VALID_EMAIL, VALID_PASSWORD);

    expect(result.success).toBe(true);
    expect(bootstrapConfiguredOwnerInTxMock).toHaveBeenCalledWith(expect.anything(), MOCK_USER_ROW);
  });
});

// ── signUp ────────────────────────────────────────────────────────────────

describe("signUp", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "http://127.0.0.1:3000";
    vi.clearAllMocks();
    normalizeEmailMock.mockImplementation((e: string) => e);
  });

  it("空邮箱返回 VALIDATION_FAILED", async () => {
    const result = await signUp("", VALID_PASSWORD, VALID_PASSWORD);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it("不含 @ 的邮箱返回 VALIDATION_FAILED", async () => {
    const result = await signUp("notanemail", VALID_PASSWORD, VALID_PASSWORD);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it(`密码长度不足 ${MIN_PASSWORD_LENGTH} 位返回 VALIDATION_FAILED`, async () => {
    const result = await signUp(VALID_EMAIL, SHORT_PASSWORD, SHORT_PASSWORD);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it("不满足 Supabase 强密码策略时在验证码前返回明确错误", async () => {
    const result = await signUp(VALID_EMAIL, "abcdef", "abcdef", "unused-token");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("大写字母、小写字母、数字和特殊字符");
    }
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("确认密码不一致时在验证码前返回错误", async () => {
    const result = await signUp(VALID_EMAIL, VALID_PASSWORD, "Aa1!xy", "unused-token");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("两次输入的密码不一致");
    }
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("Supabase signUp 失败返回 VALIDATION_FAILED（防枚举，不透传原因）", async () => {
    signUpMock.mockResolvedValue({
      data: { user: null },
      error: { message: "already registered" },
    });

    const result = await signUp(VALID_EMAIL, VALID_PASSWORD, VALID_PASSWORD);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it("siteverify success=false：用户可见行为不变，仅输出脱敏 server 日志", async () => {
    const originalSecret = process.env.TURNSTILE_SECRET_KEY;
    process.env.TURNSTILE_SECRET_KEY = "0xtest-secret-key";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          success: false,
          "error-codes": ["invalid-input-response"],
          hostname: "rival-hub-git-feat-major-educati-1f9088-starfie1d1272s-projects.vercel.app",
          action: null,
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const token = "turnstile-response-token";
      const result = await signUp(VALID_EMAIL, VALID_PASSWORD, VALID_PASSWORD, token);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
        expect(result.error.message).toBe("验证码校验失败，请刷新后重试");
      }

      // 行为不变：不触发 Supabase、不落库、不建立 session
      expect(signUpMock).not.toHaveBeenCalled();
      expect(dbInsertMock).not.toHaveBeenCalled();
      expect(createUserSessionMock).not.toHaveBeenCalled();

      // 日志内容：只有诊断字段，无 secret、无 response token、无邮箱
      expect(errorSpy).toHaveBeenCalledOnce();
      const [tag, payload] = errorSpy.mock.calls[0];
      expect(tag).toBe("[turnstile] siteverify failed");
      expect(payload).toEqual({
        errorCodes: ["invalid-input-response"],
        hostname: "rival-hub-git-feat-major-educati-1f9088-starfie1d1272s-projects.vercel.app",
        action: null,
      });
      const serialized = JSON.stringify(errorSpy.mock.calls[0]);
      expect(serialized).not.toContain("0xtest-secret-key");
      expect(serialized).not.toContain(token);
      expect(serialized).not.toContain(VALID_EMAIL);

      // siteverify 请求本身只携带 secret/response，不含其他敏感信息
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.stringify(init)).not.toContain(VALID_EMAIL);
    } finally {
      vi.unstubAllGlobals();
      errorSpy.mockRestore();
      if (originalSecret === undefined) {
        delete process.env.TURNSTILE_SECRET_KEY;
      } else {
        process.env.TURNSTILE_SECRET_KEY = originalSecret;
      }
    }
  });

  it("siteverify success=true 时流程不受日志扩展影响，正常进入注册", async () => {
    const originalSecret = process.env.TURNSTILE_SECRET_KEY;
    process.env.TURNSTILE_SECRET_KEY = "0xtest-secret-key";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true }) }),
    );
    signUpMock.mockResolvedValue({ data: { user: { id: "auth-uuid-3" } }, error: null });
    makeInsertChain([MOCK_USER_ROW]);

    try {
      const result = await signUp(VALID_EMAIL, VALID_PASSWORD, VALID_PASSWORD, "valid-token");

      expect(result.success).toBe(true);
      expect(signUpMock).toHaveBeenCalledOnce();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      errorSpy.mockRestore();
      if (originalSecret === undefined) {
        delete process.env.TURNSTILE_SECRET_KEY;
      } else {
        process.env.TURNSTILE_SECRET_KEY = originalSecret;
      }
    }
  });

  it("正常注册：insert user、发送确认流程且不创建 session", async () => {
    signUpMock.mockResolvedValue({
      data: { user: { id: "auth-uuid-2" } },
      error: null,
    });
    makeInsertChain([MOCK_USER_ROW]);

    const result = await signUp(VALID_EMAIL, VALID_PASSWORD, VALID_PASSWORD);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe(VALID_EMAIL);
    }
    expect(createUserSessionMock).not.toHaveBeenCalled();
  });
});

// ── sendPasswordResetEmail ───────────────────────────────────────────────

describe("sendPasswordResetEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://match.starfie1d.top/";
    normalizeEmailMock.mockImplementation((e: string) => e.trim().toLowerCase());
  });

  it("成功请求使用规范化的 reset redirect URL", async () => {
    resetPasswordForEmailMock.mockResolvedValue({ error: null });

    const result = await sendPasswordResetEmail(" TEST@EXAMPLE.COM ");

    expect(result.success).toBe(true);
    expect(resetPasswordForEmailMock).toHaveBeenCalledWith("test@example.com", {
      redirectTo: "https://match.starfie1d.top/reset-password",
    });
  });

  it("发信服务失败时返回统一错误而不暴露邮箱是否存在", async () => {
    resetPasswordForEmailMock.mockResolvedValue({
      error: { message: "Email address not authorized", status: 400 },
    });

    const result = await sendPasswordResetEmail("test@example.com");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(result.error.message).toBe("重置邮件暂时无法发送，请稍后重试。");
      expect(result.error.message).not.toContain("authorized");
    }
  });
});

// ── logoutUser ────────────────────────────────────────────────────────────

describe("logoutUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("正常退出只销毁 normal user session", async () => {
    destroyUserSessionMock.mockResolvedValue(undefined);

    const result = await logoutUser();

    expect(result.success).toBe(true);
    expect(destroyUserSessionMock).toHaveBeenCalledOnce();
  });
});

// ── claimInviteCode ───────────────────────────────────────────────────────

describe("claimInviteCode", () => {
  const MOCK_SESSION = mockUserSession();

  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue(MOCK_SESSION);
    createUserSessionMock.mockResolvedValue(undefined);
    revalidatePathMock.mockReturnValue(undefined);
    dbTransactionMock.mockImplementation((callback: (tx: unknown) => unknown) => callback({ insert: dbInsertMock }));
  });

  it("空邀请码返回 VALIDATION_FAILED", async () => {
    const result = await claimInviteCode("   ");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it("delegates the production transaction command and refreshes identity-only session", async () => {
    claimAdminInviteInTxMock.mockResolvedValue({
      role: "season_admin",
      userId: MOCK_SESSION.userId,
      email: MOCK_SESSION.email,
    });

    const result = await claimInviteCode(" VALID123 ");

    expect(result).toMatchObject({ success: true, data: { role: "season_admin" } });
    expect(claimAdminInviteInTxMock).toHaveBeenCalledWith(expect.objectContaining({ insert: dbInsertMock }), {
      code: "VALID123",
      userId: MOCK_SESSION.userId,
    });
    expect(createUserSessionMock).toHaveBeenCalledWith(MOCK_SESSION);
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin");
  });

});

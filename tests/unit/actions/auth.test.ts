import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";
import { mockUserSession, expectAuditLog, resetAuditTracking } from "tests/helpers";

// ── hoisted mocks ─────────────────────────────────────────────────────────
const {
  requireAuthMock,
  createUserSessionMock,
  destroyUserSessionMock,
  destroyAdminSessionMock,
  signInWithPasswordMock,
  resetPasswordForEmailMock,
  signUpMock,
  revalidatePathMock,
  normalizeEmailMock,
  // db mocks
  dbInsertMock,
  dbTransactionMock,
  txSelectMock,
  txUpdateMock,
  txInsertMock,
  updateSetCalls,
  insertValuesCalls,
  bootstrapConfiguredOwnerInTxMock,
} = vi.hoisted(() => {
  const updateSetCalls: unknown[] = [];
  const insertValuesCalls: unknown[] = [];

  return {
    requireAuthMock: vi.fn(),
    createUserSessionMock: vi.fn(),
    destroyUserSessionMock: vi.fn(),
    destroyAdminSessionMock: vi.fn(),
    signInWithPasswordMock: vi.fn(),
    resetPasswordForEmailMock: vi.fn(),
    signUpMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    normalizeEmailMock: vi.fn((email: string) => email),
    dbInsertMock: vi.fn(),
    dbTransactionMock: vi.fn(),
    txSelectMock: vi.fn(),
    txUpdateMock: vi.fn(),
    txInsertMock: vi.fn(),
    updateSetCalls,
    insertValuesCalls,
    bootstrapConfiguredOwnerInTxMock: vi.fn(),
  };
});

vi.mock("@/lib/auth/session", () => ({
  requireAuth: requireAuthMock,
  createUserSession: createUserSessionMock,
  destroyUserSession: destroyUserSessionMock,
  destroyAdminSession: destroyAdminSessionMock,
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
  // tx 对象复用，每次 transaction 调用都会执行回调并传入 tx
  const tx = {
    query: {
      adminInvites: { findFirst: vi.fn() },
    },
    select: txSelectMock,
    update: txUpdateMock,
    insert: txInsertMock,
  };

  return {
    db: {
      insert: dbInsertMock,
      transaction: dbTransactionMock.mockImplementation((callback: (tx: unknown) => unknown) =>
        callback(tx)
      ),
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
  txInsertMock.mockReturnValue(chain);
  return dbInsertMock;
}

/** 构造 tx.update(...).set(...).where(...) 链，记录 set 参数 */
function makeTxUpdateChain() {
  return txUpdateMock.mockImplementation(() => ({
    set: vi.fn((values) => {
      updateSetCalls.push(values);
      return {
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            {
              id: "user-1",
              email: "test@example.com",
              role: "season_admin",
              adminSeasonIds: ["season-1"],
            },
          ]),
        }),
      };
    }),
  }));
}

/** 构造 tx.insert(...).values(...) 链，记录 values 参数 */
function makeTxInsertChain() {
  return txInsertMock.mockImplementation(() => ({
    values: vi.fn((values) => {
      insertValuesCalls.push(values);
      return Promise.resolve();
    }),
  }));
}

const SHORT_PASSWORD = "x".repeat(MIN_PASSWORD_LENGTH - 1);
const VALID_PASSWORD = "Aa1!xx";
const VALID_EMAIL = "test@example.com";

const MOCK_USER_ROW = {
  id: "user-1",
  email: VALID_EMAIL,
  role: "user" as const,
  adminSeasonIds: [] as string[],
};

// ── loginWithPassword ─────────────────────────────────────────────────────

describe("loginWithPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuditTracking(updateSetCalls, insertValuesCalls);
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
      role: MOCK_USER_ROW.role,
      adminSeasonIds: MOCK_USER_ROW.adminSeasonIds,
      authSource: "user",
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

  it("正常退出：destroyUserSession 和 destroyAdminSession 都被调用", async () => {
    destroyUserSessionMock.mockResolvedValue(undefined);
    destroyAdminSessionMock.mockResolvedValue(undefined);

    const result = await logoutUser();

    expect(result.success).toBe(true);
    expect(destroyUserSessionMock).toHaveBeenCalledOnce();
    expect(destroyAdminSessionMock).toHaveBeenCalledOnce();
  });
});

// ── claimInviteCode ───────────────────────────────────────────────────────

describe("claimInviteCode", () => {
  const MOCK_SESSION = mockUserSession();

  const VALID_INVITE = {
    id: "invite-1",
    code: "VALID123",
    role: "season_admin" as const,
    seasonId: "season-1",
    isActive: true,
    usedCount: 0,
    maxUses: 5,
    expiresAt: null,
    usedByUsernames: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetAuditTracking(updateSetCalls, insertValuesCalls);

    requireAuthMock.mockResolvedValue(MOCK_SESSION);
    createUserSessionMock.mockResolvedValue(undefined);
    revalidatePathMock.mockReturnValue(undefined);

    // 默认让 transaction 正常执行回调
    dbTransactionMock.mockImplementation((callback: (tx: unknown) => unknown) =>
      callback({
        query: { adminInvites: { findFirst: vi.fn() }, },
        select: txSelectMock,
        update: txUpdateMock,
        insert: txInsertMock,
      })
    );
  });

  function mockLockedInvite(invite: unknown, currentUser: unknown = { role: "user" }) {
    const locked = (row: unknown) => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          for: vi.fn().mockResolvedValue(row ? [row] : []),
        }),
      }),
    });
    txSelectMock.mockReturnValueOnce(locked(invite)).mockReturnValueOnce(locked(currentUser));
  }

  it("空邀请码返回 VALIDATION_FAILED", async () => {
    const result = await claimInviteCode("   ");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it("邀请码不存在返回 UNAUTHORIZED", async () => {
    mockLockedInvite(null);

    const result = await claimInviteCode("NONEXISTENT");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.UNAUTHORIZED);
    }
  });

  it("isActive=false 的邀请码返回 UNAUTHORIZED（已失效）", async () => {
    mockLockedInvite({ ...VALID_INVITE, isActive: false });

    const result = await claimInviteCode("VALID123");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.UNAUTHORIZED);
      expect(result.error.message).toContain("失效");
    }
  });

  it("usedCount >= maxUses 返回 UNAUTHORIZED（已用完）", async () => {
    mockLockedInvite({
      ...VALID_INVITE,
      usedCount: 5,
      maxUses: 5,
    });

    const result = await claimInviteCode("VALID123");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.UNAUTHORIZED);
      expect(result.error.message).toContain("用完");
    }
  });

  it("正常使用邀请码：更新 role + 更新 invite usedCount + 写 audit_log", async () => {
    mockLockedInvite(VALID_INVITE);
    makeTxUpdateChain();
    makeTxInsertChain();

    const result = await claimInviteCode("VALID123");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("season_admin");
    }

    // 校验 user role 更新被调用
    expect(txUpdateMock).toHaveBeenCalled();

    // 校验 audit_log 写入
    expectAuditLog(insertValuesCalls, "user.claim_invite", {
      actorId: MOCK_SESSION.userId,
      targetId: MOCK_SESSION.userId,
      targetType: "user",
    });

    // 校验 revalidatePath("/admin") 被调用
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin");

    // 校验 createUserSession 以新 role 被调用
    expect(createUserSessionMock).toHaveBeenCalled();
  });

  it("stale super_admin session cannot retain super-admin after DB revocation", async () => {
    requireAuthMock.mockResolvedValue({ ...MOCK_SESSION, role: "super_admin" });
    mockLockedInvite(VALID_INVITE, { role: "user" });
    makeTxUpdateChain();
    makeTxInsertChain();

    const result = await claimInviteCode("VALID123");

    expect(result).toMatchObject({ success: true, data: { role: "season_admin" } });
    expect(updateSetCalls[0]).toMatchObject({ role: "season_admin" });
  });
});

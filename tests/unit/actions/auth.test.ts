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
  signUpMock,
  revalidatePathMock,
  normalizeEmailMock,
  // db mocks
  dbInsertMock,
  dbTransactionMock,
  inviteFindFirstMock,
  txUpdateMock,
  txInsertMock,
  updateSetCalls,
  insertValuesCalls,
} = vi.hoisted(() => {
  const updateSetCalls: unknown[] = [];
  const insertValuesCalls: unknown[] = [];

  return {
    requireAuthMock: vi.fn(),
    createUserSessionMock: vi.fn(),
    destroyUserSessionMock: vi.fn(),
    destroyAdminSessionMock: vi.fn(),
    signInWithPasswordMock: vi.fn(),
    signUpMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    normalizeEmailMock: vi.fn((email: string) => email),
    dbInsertMock: vi.fn(),
    dbTransactionMock: vi.fn(),
    inviteFindFirstMock: vi.fn(),
    txUpdateMock: vi.fn(),
    txInsertMock: vi.fn(),
    updateSetCalls,
    insertValuesCalls,
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
      signUp: signUpMock,
    },
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/lib/utils/email", () => ({
  normalizeEmail: normalizeEmailMock,
}));

vi.mock("@/db/client", () => {
  // tx 对象复用，每次 transaction 调用都会执行回调并传入 tx
  const tx = {
    query: {
      adminInvites: { findFirst: inviteFindFirstMock },
    },
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

import { loginWithPassword, signUp, logoutUser, claimInviteCode } from "@/actions/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/config/auth-config";

// ── helpers ───────────────────────────────────────────────────────────────

/** 构造 db.insert(...).values(...).onConflictDoUpdate(...).returning() 链 */
function makeInsertChain(returnValue: unknown[]) {
  return dbInsertMock.mockReturnValue({
    values: vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(returnValue),
      }),
    }),
  });
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
const VALID_PASSWORD = "x".repeat(MIN_PASSWORD_LENGTH);
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
});

// ── signUp ────────────────────────────────────────────────────────────────

describe("signUp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    normalizeEmailMock.mockImplementation((e: string) => e);
  });

  it("空邮箱返回 VALIDATION_FAILED", async () => {
    const result = await signUp("", VALID_PASSWORD);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it("不含 @ 的邮箱返回 VALIDATION_FAILED", async () => {
    const result = await signUp("notanemail", VALID_PASSWORD);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it(`密码长度不足 ${MIN_PASSWORD_LENGTH} 位返回 VALIDATION_FAILED`, async () => {
    const result = await signUp(VALID_EMAIL, SHORT_PASSWORD);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it("Supabase signUp 失败返回 VALIDATION_FAILED（防枚举，不透传原因）", async () => {
    signUpMock.mockResolvedValue({
      data: { user: null },
      error: { message: "already registered" },
    });

    const result = await signUp(VALID_EMAIL, VALID_PASSWORD);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it("正常注册：insert user + createUserSession + 返回 email", async () => {
    signUpMock.mockResolvedValue({
      data: { user: { id: "auth-uuid-2" } },
      error: null,
    });
    makeInsertChain([MOCK_USER_ROW]);
    createUserSessionMock.mockResolvedValue(undefined);

    const result = await signUp(VALID_EMAIL, VALID_PASSWORD);

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
        query: { adminInvites: { findFirst: inviteFindFirstMock } },
        update: txUpdateMock,
        insert: txInsertMock,
      })
    );
  });

  it("空邀请码返回 VALIDATION_FAILED", async () => {
    const result = await claimInviteCode("   ");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it("邀请码不存在返回 UNAUTHORIZED", async () => {
    inviteFindFirstMock.mockResolvedValue(null);

    const result = await claimInviteCode("NONEXISTENT");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.UNAUTHORIZED);
    }
  });

  it("isActive=false 的邀请码返回 UNAUTHORIZED（已失效）", async () => {
    inviteFindFirstMock.mockResolvedValue({ ...VALID_INVITE, isActive: false });

    const result = await claimInviteCode("VALID123");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.UNAUTHORIZED);
      expect(result.error.message).toContain("失效");
    }
  });

  it("usedCount >= maxUses 返回 UNAUTHORIZED（已用完）", async () => {
    inviteFindFirstMock.mockResolvedValue({
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
    inviteFindFirstMock.mockResolvedValue(VALID_INVITE);
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
});

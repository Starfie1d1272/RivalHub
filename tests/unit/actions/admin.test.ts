import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";
import { mockAdminSession, mockUserSession, findAuditEntry, expectAuditLog, resetAuditTracking } from "tests/helpers";

// ── hoisted mock 工厂 ───────────────────────────────────────────────────────

const {
  requireSuperAdminMock,
  seasonsFindFirstMock,
  adminUsersFindFirstMock,
  dbInsertMock,
  dbUpdateMock,
  dbInsertReturningMock,
  insertValuesCalls,
  updateSetCalls,
  revalidatePathMock,
  verifyPasswordMock,
  hashPasswordMock,
} = vi.hoisted(() => {
  const insertValuesCalls: unknown[] = [];
  const updateSetCalls: unknown[] = [];

  // returning() 链：用于 adminInvites insert
  const returningMock = vi.fn().mockResolvedValue([{ id: "invite-1" }]);
  const dbInsertReturningMock = returningMock;

  const dbInsertMock = vi.fn().mockImplementation(() => ({
    values: vi.fn((vals) => {
      insertValuesCalls.push(vals);
      return {
        returning: returningMock,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(undefined)),
      };
    }),
  }));

  const dbUpdateMock = vi.fn().mockImplementation(() => ({
    set: vi.fn((vals) => {
      updateSetCalls.push(vals);
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
  }));

  return {
    requireSuperAdminMock: vi.fn(),
    seasonsFindFirstMock: vi.fn(),
    adminUsersFindFirstMock: vi.fn(),
    dbInsertMock,
    dbUpdateMock,
    dbInsertReturningMock,
    insertValuesCalls,
    updateSetCalls,
    revalidatePathMock: vi.fn(),
    verifyPasswordMock: vi.fn(),
    hashPasswordMock: vi.fn().mockReturnValue("hashed:password"),
  };
});

// ── vi.mock ─────────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/session", () => ({
  requireSuperAdmin: requireSuperAdminMock,
  auditActorId: vi.fn((session: { authSource: string; userId: string; legacyAdminId?: string }) => {
    if (session.authSource === "root") {
      return `root:${session.legacyAdminId ?? session.userId}`;
    }
    return session.userId;
  }),
  // 其他导出供导入不报错
  requireAuth: vi.fn(),
  requireAdmin: vi.fn(),
  requireSeasonAdmin: vi.fn(),
  getAdminSession: vi.fn(),
  getUserSession: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/lib/utils/password", () => ({
  verifyPassword: verifyPasswordMock,
  hashPassword: hashPasswordMock,
}));

vi.mock("@/actions/transitions", () => ({
  maybeAdvanceFromRegistration: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/db/client", () => ({
  db: {
    query: {
      seasons: { findFirst: seasonsFindFirstMock },
      adminUsers: { findFirst: adminUsersFindFirstMock },
      adminInvites: { findFirst: vi.fn() },
      seasonRegistrations: { findFirst: vi.fn() },
    },
    insert: dbInsertMock,
    update: dbUpdateMock,
    transaction: vi.fn(),
  },
}));

// ── 导入被测函数（必须在 vi.mock 之后）────────────────────────────────────

import {
  createInviteCode,
  deactivateInviteCode,
  changePassword,
  deactivateAdminUser,
  reactivateAdminUser,
} from "@/actions/admin";

// ── 共用 mock session ────────────────────────────────────────────────────────

const superAdminSession = mockUserSession({
  userId: "user-super-1",
  email: "super@rival.gg",
  role: "super_admin",
});

const rootAdminSession = mockUserSession({
  userId: "admin-root-1",
  email: "RivalHub_root",
  role: "super_admin",
  authSource: "root",
  legacyAdminId: "admin-root-1",
});

// ── createInviteCode ─────────────────────────────────────────────────────────

describe("createInviteCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuditTracking(insertValuesCalls, updateSetCalls);

    requireSuperAdminMock.mockResolvedValue(superAdminSession);

    // insert().values() 链：第一次调用返回 invite id（用于 adminInvites），后续调用（auditLogs）返回 undefined
    let insertCallCount = 0;
    dbInsertMock.mockImplementation(() => ({
      values: vi.fn((vals) => {
        insertValuesCalls.push(vals);
        insertCallCount++;
        return {
          returning: vi.fn().mockResolvedValue([{ id: "invite-1" }]),
          then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(undefined)),
        };
      }),
    }));
    void insertCallCount; // suppress unused warning
  });

  it("super_admin 正常创建邀请码（不指定赛季，role=super_admin）", async () => {
    const result = await createInviteCode({ role: "super_admin", maxUses: 2 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("super_admin");
      expect(result.data.maxUses).toBe(2);
      expect(typeof result.data.code).toBe("string");
      expect(result.data.code).toHaveLength(16); // randomBytes(8).toString("hex")
      expect(result.data.seasonId).toBeNull();
    }

    // audit_log 被写入
    expectAuditLog(insertValuesCalls, "admin.create_invite", { actorId: "user-super-1" });

    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/invites");
  });

  it("role=admin + 有效 seasonId 正常创建", async () => {
    seasonsFindFirstMock.mockResolvedValue({ id: "season-1" });

    const result = await createInviteCode({
      role: "admin",
      seasonId: "season-1",
      maxUses: 1,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.seasonId).toBe("season-1");
      expect(result.data.role).toBe("admin");
    }

    expectAuditLog(insertValuesCalls, "admin.create_invite");
  });

  it("role=admin 缺少 seasonId 应返回 fail（VALIDATION_FAILED）", async () => {
    const result = await createInviteCode({ role: "admin" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
    // 不应写 audit_log
    const entry = findAuditEntry(insertValuesCalls, "admin.create_invite");
    expect(entry).toBeUndefined();
  });

  it("role=admin + seasonId 不存在应返回 fail（SEASON_NOT_FOUND）", async () => {
    seasonsFindFirstMock.mockResolvedValue(undefined);

    const result = await createInviteCode({ role: "admin", seasonId: "nonexistent" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.SEASON_NOT_FOUND);
    }
  });

  it("设置 expiresInHours 时 expiresAt 应非 null", async () => {
    seasonsFindFirstMock.mockResolvedValue({ id: "season-1" });

    const before = Date.now();
    const result = await createInviteCode({
      role: "admin",
      seasonId: "season-1",
      expiresInHours: 24,
    });
    const after = Date.now();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expiresAt).not.toBeNull();
      const expMs = new Date(result.data.expiresAt!).getTime();
      expect(expMs).toBeGreaterThanOrEqual(before + 24 * 3600_000 - 100);
      expect(expMs).toBeLessThanOrEqual(after + 24 * 3600_000 + 100);
    }
  });
});

// ── deactivateInviteCode ─────────────────────────────────────────────────────

describe("deactivateInviteCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuditTracking(insertValuesCalls, updateSetCalls);

    requireSuperAdminMock.mockResolvedValue(superAdminSession);

    dbUpdateMock.mockImplementation(() => ({
      set: vi.fn((vals) => {
        updateSetCalls.push(vals);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    }));

    dbInsertMock.mockImplementation(() => ({
      values: vi.fn((vals) => {
        insertValuesCalls.push(vals);
        return Promise.resolve();
      }),
    }));
  });

  it("正常停用邀请码并写入 audit_log", async () => {
    const result = await deactivateInviteCode("invite-abc");

    expect(result.success).toBe(true);

    // update 设置 isActive: false
    expect(updateSetCalls).toContainEqual({ isActive: false });

    // audit_log 正确写入
    expectAuditLog(insertValuesCalls, "admin.deactivate_invite", {
      targetId: "invite-abc",
      targetType: "admin_invite",
      actorId: "user-super-1",
    });

    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/invites");
  });

  it("root 账号停用邀请码时 actorId 格式为 root:xxx", async () => {
    requireSuperAdminMock.mockResolvedValue(rootAdminSession);

    const result = await deactivateInviteCode("invite-xyz");

    expect(result.success).toBe(true);
    expectAuditLog(insertValuesCalls, "admin.deactivate_invite", { actorId: "root:admin-root-1" });
  });
});

// ── changePassword ───────────────────────────────────────────────────────────

describe("changePassword", () => {
  const rootSession = {
    ...rootAdminSession,
    legacyAdminId: "admin-root-1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetAuditTracking(insertValuesCalls, updateSetCalls);

    requireSuperAdminMock.mockResolvedValue(rootSession);

    adminUsersFindFirstMock.mockResolvedValue({
      id: "admin-root-1",
      username: "RivalHub_root",
      passwordHash: "salt:hash",
      isActive: true,
      role: "super_admin",
    });

    verifyPasswordMock.mockReturnValue(true);

    dbUpdateMock.mockImplementation(() => ({
      set: vi.fn((vals) => {
        updateSetCalls.push(vals);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    }));

    dbInsertMock.mockImplementation(() => ({
      values: vi.fn((vals) => {
        insertValuesCalls.push(vals);
        return Promise.resolve();
      }),
    }));
  });

  it("新密码太短（< 8 字符）返回 fail（VALIDATION_FAILED）", async () => {
    const result = await changePassword("current123", "short");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(result.error.message).toContain("8");
    }
    expect(updateSetCalls).toHaveLength(0);
  });

  it("非 root authSource 返回 fail（FORBIDDEN）", async () => {
    requireSuperAdminMock.mockResolvedValue({
      ...superAdminSession,
      authSource: "user",
      legacyAdminId: undefined,
    });

    const result = await changePassword("current123", "newpassword123");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.FORBIDDEN);
    }
  });

  it("当前密码错误返回 fail（VALIDATION_FAILED）", async () => {
    verifyPasswordMock.mockReturnValue(false);

    const result = await changePassword("wrongpass", "newpassword123");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(result.error.message).toContain("当前密码错误");
    }
    expect(updateSetCalls).toHaveLength(0);
  });

  it("管理员账户不存在返回 fail（NOT_FOUND）", async () => {
    adminUsersFindFirstMock.mockResolvedValue(undefined);

    const result = await changePassword("current123", "newpassword123");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.NOT_FOUND);
    }
  });

  it("正常修改密码：update + audit_log 均被调用", async () => {
    const result = await changePassword("correctpass", "newpassword123");

    expect(result.success).toBe(true);

    // update 包含 passwordHash
    expect(updateSetCalls[0]).toMatchObject({
      passwordHash: "hashed:password",
    });

    // audit_log 正确写入
    expectAuditLog(insertValuesCalls, "admin.change_password", {
      targetId: "admin-root-1",
      targetType: "admin_user",
    });
  });
});

// ── deactivateAdminUser ──────────────────────────────────────────────────────

describe("deactivateAdminUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuditTracking(insertValuesCalls, updateSetCalls);

    requireSuperAdminMock.mockResolvedValue(rootAdminSession);

    adminUsersFindFirstMock.mockResolvedValue({
      id: "admin-other",
      username: "other_admin",
      isActive: true,
      role: "admin",
    });

    dbUpdateMock.mockImplementation(() => ({
      set: vi.fn((vals) => {
        updateSetCalls.push(vals);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    }));

    dbInsertMock.mockImplementation(() => ({
      values: vi.fn((vals) => {
        insertValuesCalls.push(vals);
        return Promise.resolve();
      }),
    }));
  });

  it("不能停用自己（root 账号，legacyAdminId 匹配）", async () => {
    // rootAdminSession.legacyAdminId === "admin-root-1"，尝试停用同一 id
    const result = await deactivateAdminUser("admin-root-1");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(result.error.message).toContain("不能停用自己");
    }
    expect(updateSetCalls).toHaveLength(0);
  });

  it("不能停用 RivalHub_root 账号", async () => {
    adminUsersFindFirstMock.mockResolvedValue({
      id: "admin-other",
      username: "RivalHub_root",
      isActive: true,
      role: "super_admin",
    });

    const result = await deactivateAdminUser("admin-other");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.FORBIDDEN);
      expect(result.error.message).toContain("根管理员");
    }
    expect(updateSetCalls).toHaveLength(0);
  });

  it("目标管理员不存在返回 fail（NOT_FOUND）", async () => {
    adminUsersFindFirstMock.mockResolvedValue(undefined);

    const result = await deactivateAdminUser("nonexistent-id");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.NOT_FOUND);
    }
    expect(updateSetCalls).toHaveLength(0);
  });

  it("正常停用：update isActive=false + audit_log 写入", async () => {
    const result = await deactivateAdminUser("admin-other");

    expect(result.success).toBe(true);

    expect(updateSetCalls[0]).toMatchObject({ isActive: false });

    expectAuditLog(insertValuesCalls, "admin.deactivate_user", {
      targetId: "admin-other",
      targetType: "admin_user",
    });
    const auditEntry = findAuditEntry(insertValuesCalls, "admin.deactivate_user");
    expect((auditEntry as { meta: { targetUsername: string } }).meta.targetUsername).toBe(
      "other_admin",
    );

    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/users");
  });

  it("普通 super_admin（非 root）停用他人时正常通过", async () => {
    requireSuperAdminMock.mockResolvedValue(superAdminSession);

    const result = await deactivateAdminUser("admin-other");

    expect(result.success).toBe(true);
  });
});

// ── reactivateAdminUser ──────────────────────────────────────────────────────

describe("reactivateAdminUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuditTracking(insertValuesCalls, updateSetCalls);

    requireSuperAdminMock.mockResolvedValue(superAdminSession);

    dbUpdateMock.mockImplementation(() => ({
      set: vi.fn((vals) => {
        updateSetCalls.push(vals);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    }));

    dbInsertMock.mockImplementation(() => ({
      values: vi.fn((vals) => {
        insertValuesCalls.push(vals);
        return Promise.resolve();
      }),
    }));
  });

  it("正常启用管理员：update isActive=true + audit_log 写入", async () => {
    const result = await reactivateAdminUser("admin-other");

    expect(result.success).toBe(true);

    expect(updateSetCalls[0]).toMatchObject({ isActive: true });

    expectAuditLog(insertValuesCalls, "admin.reactivate_user", {
      targetId: "admin-other",
      targetType: "admin_user",
      actorId: "user-super-1",
    });

    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/users");
  });

  it("root 账号启用时 actorId 格式为 root:xxx", async () => {
    requireSuperAdminMock.mockResolvedValue(rootAdminSession);

    const result = await reactivateAdminUser("admin-other");

    expect(result.success).toBe(true);

    expectAuditLog(insertValuesCalls, "admin.reactivate_user", { actorId: "root:admin-root-1" });
  });
});

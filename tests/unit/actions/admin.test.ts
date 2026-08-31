import { beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorCode } from "@/lib/errors";
import { expectAuditLog, mockUserSession } from "tests/helpers";

const {
  requireSuperAdminMock,
  seasonsFindFirstMock,
  dbInsertMock,
  dbUpdateMock,
  dbTransactionMock,
  txSelectMock,
  txDeleteMock,
  txUpdateMock,
  txInsertMock,
  insertValuesCalls,
  updateSetCalls,
  revalidatePathMock,
} = vi.hoisted(() => ({
  requireSuperAdminMock: vi.fn(),
  seasonsFindFirstMock: vi.fn(),
  dbInsertMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  dbTransactionMock: vi.fn(),
  txSelectMock: vi.fn(),
  txDeleteMock: vi.fn(),
  txUpdateMock: vi.fn(),
  txInsertMock: vi.fn(),
  insertValuesCalls: [] as unknown[],
  updateSetCalls: [] as unknown[],
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireSuperAdmin: requireSuperAdminMock,
  requireSeasonAdmin: vi.fn(),
  auditActorId: (session: { userId: string }) => session.userId,
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/actions/transitions", () => ({ maybeAdvanceFromRegistration: vi.fn() }));
vi.mock("@/db/client", () => ({
  db: {
    query: { seasons: { findFirst: seasonsFindFirstMock } },
    insert: dbInsertMock,
    update: dbUpdateMock,
    transaction: dbTransactionMock,
  },
}));

import {
  createInviteCode,
  deactivateInviteCode,
  revokeUserAdminRole,
} from "@/actions/admin";

const superAdmin = mockUserSession({
  userId: "user-super-1",
  email: "super@rival.gg",
});

function configureInsert() {
  const insert = () => ({
    values: vi.fn((values: unknown) => {
      insertValuesCalls.push(values);
      return { returning: vi.fn().mockResolvedValue([{ id: "invite-1" }]) };
    }),
  });
  dbInsertMock.mockImplementation(insert);
  txInsertMock.mockImplementation(insert);
}

function configureTransaction(target: unknown, grants: unknown[]) {
  const targetChain = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        for: vi.fn().mockResolvedValue(target ? [target] : []),
      }),
    }),
  };
  const grantsChain = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(grants),
    }),
  };
  txSelectMock.mockReturnValueOnce(targetChain).mockReturnValueOnce(grantsChain);
  txDeleteMock.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  txUpdateMock.mockImplementation(() => ({
    set: vi.fn((values: unknown) => {
      updateSetCalls.push(values);
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
  }));
  txInsertMock.mockReturnValue({ values: vi.fn((values: unknown) => {
    insertValuesCalls.push(values);
    return Promise.resolve();
  }) });
  dbTransactionMock.mockImplementation((callback: (tx: unknown) => unknown) =>
    callback({
      select: txSelectMock,
      delete: txDeleteMock,
      update: txUpdateMock,
      insert: txInsertMock,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  insertValuesCalls.length = 0;
  updateSetCalls.length = 0;
  requireSuperAdminMock.mockResolvedValue(superAdmin);
  configureInsert();
  dbTransactionMock.mockImplementation((callback: (tx: unknown) => unknown) =>
    callback({
      select: txSelectMock,
      delete: txDeleteMock,
      update: txUpdateMock,
      insert: txInsertMock,
    }),
  );
});

describe("createInviteCode", () => {
  it("创建 global super_admin invite 并记录 actor", async () => {
    const result = await createInviteCode({ role: "super_admin", maxUses: 2 });

    expect(result).toMatchObject({
      success: true,
      data: { role: "super_admin", seasonId: null, maxUses: 2 },
    });
    expectAuditLog(insertValuesCalls, "admin.create_invite", { actorId: superAdmin.userId });
  });

  it("创建 scoped season_admin invite", async () => {
    seasonsFindFirstMock.mockResolvedValue({ id: "season-1" });

    const result = await createInviteCode({ role: "season_admin", seasonId: "season-1" });

    expect(result).toMatchObject({
      success: true,
      data: { role: "season_admin", seasonId: "season-1" },
    });
  });

  const invalidInviteInputs: Array<[Parameters<typeof createInviteCode>[0], string]> = [
    [{ role: "season_admin" }, "请选择赛季范围"],
    [{ role: "super_admin", seasonId: "season-1" }, "不能绑定赛季范围"],
    [{ role: "super_admin", maxUses: 0 }, "使用次数必须是正整数"],
    [{ role: "super_admin", expiresInHours: 0 }, "有效期必须是正数"],
  ];

  it.each(invalidInviteInputs)("拒绝不满足 DB scope/使用约束的输入 %#", async (input, message) => {
    const result = await createInviteCode(input);

    expect(result).toMatchObject({ success: false, error: { code: ErrorCode.VALIDATION_FAILED } });
    if (!result.success) expect(result.error.message).toContain(message);
    expect(dbInsertMock).not.toHaveBeenCalled();
  });

  it("拒绝不存在的赛季", async () => {
    seasonsFindFirstMock.mockResolvedValue(undefined);

    const result = await createInviteCode({ role: "season_admin", seasonId: "missing" });

    expect(result).toMatchObject({ success: false, error: { code: ErrorCode.SEASON_NOT_FOUND } });
  });
});

describe("deactivateInviteCode", () => {
  it("停用 invite 并写入 user actor 的 audit", async () => {
    txSelectMock.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          for: vi.fn().mockResolvedValue([{ id: "invite-1", seasonId: "season-1" }]),
        }),
      }),
    });
    txUpdateMock.mockReturnValue({
      set: vi.fn((values: unknown) => {
        updateSetCalls.push(values);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    });

    const result = await deactivateInviteCode("invite-1");

    expect(result).toMatchObject({ success: true });
    expect(updateSetCalls).toContainEqual({ isActive: false });
    expectAuditLog(insertValuesCalls, "admin.deactivate_invite", {
      actorId: superAdmin.userId,
      targetId: "invite-1",
    });
  });
});

describe("revokeUserAdminRole", () => {
  it("锁定目标、删除 grants、降为 user 并保留撤销范围 audit", async () => {
    configureTransaction({ id: "user-2", role: "user" }, [{ seasonId: "season-1" }]);

    const result = await revokeUserAdminRole("user-2");

    expect(result).toMatchObject({ success: true });
    expect(txDeleteMock).toHaveBeenCalledOnce();
    expect(updateSetCalls).toContainEqual({ role: "user", updatedAt: expect.any(Date) });
    expectAuditLog(insertValuesCalls, "admin.revoke_role", {
      actorId: superAdmin.userId,
      targetId: "user-2",
    });
    const audit = insertValuesCalls.find(
      (value): value is { action: string; meta: { seasonIds: string[] } } =>
        typeof value === "object" && value !== null && (value as { action?: string }).action === "admin.revoke_role",
    );
    expect(audit?.meta.seasonIds).toEqual(["season-1"]);
  });

  it("不能撤销自己的权限", async () => {
    const result = await revokeUserAdminRole(superAdmin.userId);

    expect(result).toMatchObject({ success: false, error: { code: ErrorCode.VALIDATION_FAILED } });
    expect(dbTransactionMock).not.toHaveBeenCalled();
  });
});

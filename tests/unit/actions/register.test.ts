import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";
import { mockUserSession, createFakeSeason, createFakeUser, expectAuditLog, resetAuditTracking } from "tests/helpers";

// ── 合法 UUID 常量 ─────────────────────────────────────────────────────────────
const SEASON_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const REG_ID = "33333333-3333-3333-3333-333333333333";

// ── hoisted mock refs ──────────────────────────────────────────────────────────
const {
  seasonFindFirstMock,
  userFindFirstMock,
  registrationFindFirstMock,
  selectMock,
  updateMock,
  insertMock,
  deleteMock,
  insertValuesCalls,
  getRegistrationWindowStateMock,
  getUserSessionMock,
  buildRegistrationSchemaMock,
  getSteamAvatarMock,
  revalidatePathMock,
} = vi.hoisted(() => {
  const insertValuesCalls: unknown[] = [];
  return {
    seasonFindFirstMock: vi.fn(),
    userFindFirstMock: vi.fn(),
    registrationFindFirstMock: vi.fn(),
    selectMock: vi.fn(),
    updateMock: vi.fn(),
    insertMock: vi.fn(),
    deleteMock: vi.fn(),
    insertValuesCalls,
    getRegistrationWindowStateMock: vi.fn(),
    getUserSessionMock: vi.fn(),
    buildRegistrationSchemaMock: vi.fn(),
    getSteamAvatarMock: vi.fn(),
    revalidatePathMock: vi.fn(),
  };
});

// ── mocks ─────────────────────────────────────────────────────────────────────
vi.mock("@/db/client", () => ({
  db: {
    query: {
      seasons: { findFirst: seasonFindFirstMock },
      users: { findFirst: userFindFirstMock },
      seasonRegistrations: { findFirst: registrationFindFirstMock },
    },
    select: selectMock,
    update: updateMock,
    insert: insertMock,
    delete: deleteMock,
  },
}));

vi.mock("@/lib/registration/window", () => ({
  getRegistrationWindowState: getRegistrationWindowStateMock,
}));

vi.mock("@/lib/auth/session", () => ({
  getUserSession: getUserSessionMock,
}));

vi.mock("@/lib/validators/registration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/validators/registration")>();
  return {
    ...actual,
    buildRegistrationSchema: buildRegistrationSchemaMock,
  };
});

vi.mock("@/lib/utils/email", () => ({
  normalizeEmail: (email: string) => email.trim().toLowerCase(),
}));

vi.mock("@/lib/utils/object", () => ({
  compactUndefined: (obj: Record<string, unknown>) => obj,
}));

vi.mock("@/lib/steam", () => ({
  getSteamAvatar: getSteamAvatarMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

// ── import after mocks ─────────────────────────────────────────────────────────
import { submitRegistration, saveRegistrationDraft } from "@/actions/register";

// ── 公共测试数据 ──────────────────────────────────────────────────────────────
const SEASON = createFakeSeason({
  id: SEASON_ID,
  slug: "spring-2026",
  status: "registration",
  startAt: null,
  registrationDeadline: null,
  registrationConfig: null,
  positions: ["opener", "closer", "anchor"],
});

const SESSION = mockUserSession({ userId: USER_ID, email: "player@example.com" });

const USER = createFakeUser({ id: USER_ID, email: "player@example.com" });

// VALID_INPUT 的 seasonId 必须是合法 UUID（registrationSeedSchema 用 z.string().uuid()）
const VALID_INPUT = {
  seasonId: SEASON_ID,
  email: "player@example.com",
  studentId: "220000001",
  playerType: "undergraduate",
  qq: "12345678",
  perfectName: "TestPlayer",
  steamName: "test_steam",
  steam64: "76561198000000001",
  steamProfileUrl: "https://steamcommunity.com/id/test",
  primaryPosition: "opener",
  secondaryPosition: "closer",
  peakRank: "黄金",
  peakRankSeason: "S1 2026",
  peakRating: 1.5,
  currentSeasonPeakRank: "黄金",
  currentRating: 1.4,
  screenshotUrls: ["https://njubox.example.com/ss1"],
  mapPreferences: [],
  gameplayStyle: "积极型",
  willingToBeCaptain: false,
  antiCheatPledge: true as const,
};

// ── 工具：mock db.select 链式调用返回 [{count: N}] ──────────────────────────
function mockSelectCount(n: number) {
  selectMock.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ count: n }]),
    }),
  });
}

// ── 工具：mock db.update(users).set.where.returning ─────────────────────────
function mockUpdateReturning(rows: unknown[]) {
  updateMock.mockReturnValueOnce({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(rows),
      }),
    }),
  });
}

// ── 工具：mock buildRegistrationSchema 返回 safeParse 成功 ──────────────────
function mockSchemaSuccess(data = VALID_INPUT) {
  buildRegistrationSchemaMock.mockReturnValue({
    safeParse: vi.fn().mockReturnValue({ success: true, data }),
  });
}

// ── 工具：mock buildRegistrationSchema 返回 safeParse 失败 ──────────────────
function mockSchemaFail(fieldErrors: Record<string, string[]>) {
  buildRegistrationSchemaMock.mockReturnValue({
    safeParse: vi.fn().mockReturnValue({
      success: false,
      error: { flatten: () => ({ fieldErrors }) },
    }),
  });
}

// ── 工具：setup 公共 happy-path 前置 mock（season + window + session）────────
function setupHappyPathBase() {
  seasonFindFirstMock.mockResolvedValue(SEASON);
  getRegistrationWindowStateMock.mockReturnValue({ canSubmit: true });
  getUserSessionMock.mockResolvedValue(SESSION);
  mockSchemaSuccess();
}

// ─────────────────────────────────────────────────────────────────────────────
describe("submitRegistration()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuditTracking(insertValuesCalls);
    getSteamAvatarMock.mockResolvedValue(null);
  });

  it("seedSchema 校验失败（缺少 seasonId）返回 fieldErrors", async () => {
    // 传入空对象，seasonId 缺失
    const result = await submitRegistration({} as never);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(result.error.fieldErrors).toBeDefined();
    }
  });

  it("赛季不存在返回 SEASON_NOT_FOUND", async () => {
    seasonFindFirstMock.mockResolvedValue(null);
    getRegistrationWindowStateMock.mockReturnValue({ canSubmit: true });

    const result = await submitRegistration(VALID_INPUT as never);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.SEASON_NOT_FOUND);
    }
  });

  it("报名窗口关闭（canSubmit=false）返回 REGISTRATION_CLOSED", async () => {
    seasonFindFirstMock.mockResolvedValue(SEASON);
    getRegistrationWindowStateMock.mockReturnValue({
      canSubmit: false,
      message: "报名提交已截止。",
    });

    const result = await submitRegistration(VALID_INPUT as never);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.REGISTRATION_CLOSED);
    }
  });

  it("未登录（session 为 null）返回 UNAUTHORIZED", async () => {
    seasonFindFirstMock.mockResolvedValue(SEASON);
    getRegistrationWindowStateMock.mockReturnValue({ canSubmit: true });
    getUserSessionMock.mockResolvedValue(null);
    mockSchemaSuccess();

    const result = await submitRegistration(VALID_INPUT as never);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.UNAUTHORIZED);
    }
  });

  it("完整 schema 校验失败（字段错误）返回 fieldErrors", async () => {
    seasonFindFirstMock.mockResolvedValue(SEASON);
    getRegistrationWindowStateMock.mockReturnValue({ canSubmit: true });
    getUserSessionMock.mockResolvedValue(SESSION);
    mockSchemaFail({ qq: ["请输入有效的 QQ 号（5-12 位数字）"] });

    const result = await submitRegistration(VALID_INPUT as never);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(result.error.fieldErrors?.qq).toBe("请输入有效的 QQ 号（5-12 位数字）");
    }
  });

  it("报名邮箱与登录邮箱不一致返回 FORBIDDEN", async () => {
    seasonFindFirstMock.mockResolvedValue(SEASON);
    getRegistrationWindowStateMock.mockReturnValue({ canSubmit: true });
    getUserSessionMock.mockResolvedValue({ ...SESSION, email: "other@example.com" });
    mockSchemaSuccess();

    const result = await submitRegistration(VALID_INPUT as never);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.FORBIDDEN);
      expect(result.error.message).toContain("邮箱");
    }
  });

  it("用户记录不存在返回 UNAUTHORIZED（账号数据异常）", async () => {
    setupHappyPathBase();
    userFindFirstMock.mockResolvedValue(null);

    const result = await submitRegistration(VALID_INPUT as never);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.UNAUTHORIZED);
    }
  });

  it("已通过报名返回 REGISTRATION_DUPLICATE", async () => {
    setupHappyPathBase();
    userFindFirstMock.mockResolvedValue(USER);
    registrationFindFirstMock.mockResolvedValue({ id: REG_ID, status: "approved" });

    const result = await submitRegistration(VALID_INPUT as never);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.REGISTRATION_DUPLICATE);
    }
  });

  it("待审核报名可更新并保持待审核", async () => {
    setupHappyPathBase();
    userFindFirstMock.mockResolvedValue(USER);
    registrationFindFirstMock.mockResolvedValue({ id: REG_ID, status: "pending" });

    mockSelectCount(0);
    mockSelectCount(0);
    mockUpdateReturning([{ ...USER, steam64: VALID_INPUT.steam64 }]);

    updateMock.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: REG_ID, status: "pending" }]),
        }),
      }),
    });

    deleteMock.mockReturnValueOnce({
      where: vi.fn().mockResolvedValue(undefined),
    });

    insertMock.mockReturnValueOnce({
      values: vi.fn((vals: unknown) => {
        insertValuesCalls.push(vals);
        return Promise.resolve();
      }),
    });

    const result = await submitRegistration(VALID_INPUT as never);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.registrationId).toBe(REG_ID);
    }
    expectAuditLog(insertValuesCalls, "registration.submit", { actorId: USER_ID, targetId: REG_ID });
  });

  it("正常提交成功：insert registration + delete draft + audit_log", async () => {
    setupHappyPathBase();
    userFindFirstMock.mockResolvedValue(USER);
    registrationFindFirstMock.mockResolvedValue(null); // 未重复报名

    // SELECT count: totalCount = 0
    mockSelectCount(0);
    // SELECT count: posCount = 0
    mockSelectCount(0);

    // db.update(users) returning updated user
    mockUpdateReturning([{ ...USER, steam64: VALID_INPUT.steam64 }]);

    const NEW_REG_ID = "44444444-4444-4444-4444-444444444444";

    // db.insert(seasonRegistrations).values(...).returning()
    insertMock
      .mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: NEW_REG_ID }]),
        }),
      })
      // db.insert(auditLogs).values(...)
      .mockReturnValueOnce({
        values: vi.fn((vals: unknown) => {
          insertValuesCalls.push(vals);
          return Promise.resolve();
        }),
      });

    // db.delete(registrationDrafts).where(...)
    deleteMock.mockReturnValueOnce({
      where: vi.fn().mockResolvedValue(undefined),
    });

    const result = await submitRegistration(VALID_INPUT as never);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.registrationId).toBe(NEW_REG_ID);
      expect(result.data.email).toBe(VALID_INPUT.email);
    }

    // audit_log action + fields
    expectAuditLog(insertValuesCalls, "registration.submit", { actorId: USER_ID, targetId: NEW_REG_ID });

    expect(revalidatePathMock).toHaveBeenCalledWith(`/${SEASON.slug}/register`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("saveRegistrationDraft()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuditTracking(insertValuesCalls);
  });

  it("schema 校验失败（邮箱无效）返回 VALIDATION_FAILED + fieldErrors", async () => {
    const result = await saveRegistrationDraft({
      seasonId: SEASON_ID,
      email: "not-an-email",
      payload: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(result.error.fieldErrors).toBeDefined();
    }
  });

  it("schema 校验失败（seasonId 非 UUID）返回 VALIDATION_FAILED", async () => {
    const result = await saveRegistrationDraft({
      seasonId: "not-a-uuid",
      email: "player@example.com",
      payload: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it("赛季不存在返回 SEASON_NOT_FOUND", async () => {
    seasonFindFirstMock.mockResolvedValue(null);

    const result = await saveRegistrationDraft({
      seasonId: SEASON_ID,
      email: "player@example.com",
      payload: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.SEASON_NOT_FOUND);
    }
  });

  it("报名窗口不允许保存草稿返回 REGISTRATION_CLOSED", async () => {
    seasonFindFirstMock.mockResolvedValue(SEASON);
    getRegistrationWindowStateMock.mockReturnValue({
      canSaveDraft: false,
      message: "报名通道当前不可用。",
    });

    const result = await saveRegistrationDraft({
      seasonId: SEASON_ID,
      email: "player@example.com",
      payload: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.REGISTRATION_CLOSED);
    }
  });

  it("正常保存草稿成功，返回规范化后的 email", async () => {
    seasonFindFirstMock.mockResolvedValue(SEASON);
    getRegistrationWindowStateMock.mockReturnValue({ canSaveDraft: true });

    // db.insert(registrationDrafts).values(...).onConflictDoUpdate(...)
    insertMock.mockReturnValueOnce({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    });

    // draftSchema 的 email 字段不做 trim，传入时不加空格
    const result = await saveRegistrationDraft({
      seasonId: SEASON_ID,
      email: "Player@Example.COM",
      payload: { steamName: "test" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // normalizeEmail 会转小写
      expect(result.data.email).toBe("player@example.com");
    }
    expect(revalidatePathMock).toHaveBeenCalledWith(`/${SEASON.slug}/register`);
  });
});

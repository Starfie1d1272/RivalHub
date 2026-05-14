import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";
import { expectAuditLog, findAuditEntry, resetAuditTracking, mockUserSession } from "tests/helpers";

// ── UUID 常量 ─────────────────────────────────────────────────────────────────
const SEASON_ID = "00000000-0000-0000-0000-000000000001";
const NONEXISTENT_ID = "00000000-0000-0000-0000-000000000099";

// ── hoisted mock 工厂 ───────────────────────────────────────────────────────

const {
  requireSuperAdminMock,
  seasonsFindFirstMock,
  dbInsertMock,
  dbUpdateMock,
  dbDeleteMock,
  dbSelectMock,
  insertValuesCalls,
  updateSetCalls,
  revalidatePathMock,
} = vi.hoisted(() => {
  const insertValuesCalls: unknown[] = [];
  const updateSetCalls: unknown[] = [];

  const dbInsertMock = vi.fn().mockImplementation(() => ({
    values: vi.fn((vals: unknown) => {
      insertValuesCalls.push(vals);
      return {
        returning: vi.fn().mockResolvedValue([{ id: "season-new", slug: "test-2026" }]),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(undefined)),
      };
    }),
  }));

  const dbUpdateMock = vi.fn().mockImplementation(() => ({
    set: vi.fn((vals: unknown) => {
      updateSetCalls.push(vals);
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
  }));

  const dbDeleteMock = vi.fn().mockImplementation(() => ({
    where: vi.fn().mockResolvedValue(undefined),
  }));

  const dbSelectMock = vi.fn().mockImplementation(() => ({
    from: vi.fn(() => ({
      where: vi.fn().mockResolvedValue([{ value: 0 }]),
    })),
  }));

  return {
    requireSuperAdminMock: vi.fn(),
    seasonsFindFirstMock: vi.fn(),
    dbInsertMock,
    dbUpdateMock,
    dbDeleteMock,
    dbSelectMock,
    insertValuesCalls,
    updateSetCalls,
    revalidatePathMock: vi.fn(),
  };
});

// ── vi.mock ─────────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/session", () => ({
  requireSuperAdmin: requireSuperAdminMock,
  auditActorId: vi.fn(
    (session: { authSource: string; userId: string; legacyAdminId?: string }) => {
      if (session.authSource === "root") {
        return `root:${session.legacyAdminId ?? session.userId}`;
      }
      return session.userId;
    },
  ),
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

vi.mock("@/db/client", () => ({
  db: {
    query: {
      seasons: { findFirst: seasonsFindFirstMock },
    },
    insert: dbInsertMock,
    update: dbUpdateMock,
    delete: dbDeleteMock,
    select: dbSelectMock,
  },
}));

// ── 导入被测函数（必须在 vi.mock 之后）────────────────────────────────────

import {
  createSeason,
  updateSeason,
  publishSeason,
  deleteSeason,
} from "@/actions/seasons";

// ── 共用数据 ────────────────────────────────────────────────────────────────

const superAdminSession = mockUserSession({
  userId: "user-super-1",
  email: "super@rival.gg",
  role: "super_admin",
});

const VALID_INPUT = {
  name: "Test Season 2026",
  slug: "test-2026",
  kind: "联赛",
  registrationMode: "solo" as const,
  hasCaptainVoting: true,
  hasDraft: true,
  minTeamSize: 4,
  maxTeamSize: 8,
  starterCount: 5,
  positions: ["opener", "closer", "anchor"],
  stagePlan: [
    {
      key: "swiss-1",
      name: "瑞士轮第1轮",
      type: "swiss" as const,
      teamCount: 32,
      advanceTiers: [] as { placement: string; count: number; targetRound?: string }[],
    },
  ],
  registrationConfig: {
    allowedPlayerTypes: ["enrolled"] as const,
    rankThreshold: { currentMin: null as string | null, peakMin: null as string | null },
    maxPerPosition: 3,
    screenshotCount: 2,
    maxTotal: 200,
    mapPool: ["de_dust2", "de_mirage", "de_inferno"],
  },
  startAt: null as string | null,
  registrationDeadline: null as string | null,
  endAt: null as string | null,
  themeColor: null as string | null,
};

function draftSeason(overrides?: Record<string, unknown>) {
  return {
    id: SEASON_ID,
    slug: "test-2026",
    name: "Test Season 2026",
    kind: "联赛",
    status: "draft",
    registrationMode: "solo",
    hasCaptainVoting: true,
    hasDraft: true,
    minTeamSize: 4,
    maxTeamSize: 8,
    starterCount: 5,
    positions: ["opener", "closer", "anchor"],
    stagePlan: VALID_INPUT.stagePlan,
    registrationConfig: VALID_INPUT.registrationConfig,
    teamRegistrationConfig: null,
    themeColor: null,
    startAt: null,
    registrationDeadline: null,
    endAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function nonDraftSeason(status = "registration") {
  return draftSeason({ status });
}

// ── createSeason ────────────────────────────────────────────────────────────

describe("createSeason", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuditTracking(insertValuesCalls, updateSetCalls);
    requireSuperAdminMock.mockResolvedValue(superAdminSession);
  });

  it("使用合法输入创建赛季，返回 seasonId/slug，写入审计日志，刷新路径", async () => {
    const result = await createSeason(VALID_INPUT);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.seasonId).toBe("season-new");
      expect(result.data.slug).toBe("test-2026");
    }

    expectAuditLog(insertValuesCalls, "season.create", {
      actorId: "user-super-1",
      targetType: "season",
    });
    const entry = findAuditEntry(insertValuesCalls, "season.create");
    expect(entry).toBeDefined();
    expect((entry as { meta: { slug: string } }).meta.slug).toBe("test-2026");

    expect(revalidatePathMock).toHaveBeenCalledWith("/admin");
  });

  it("缺少 name 校验失败，返回 VALIDATION_FAILED", async () => {
    const result = await createSeason({ ...VALID_INPUT, name: "" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(result.error.fieldErrors).toBeDefined();
    }
  });

  it("slug 格式不合法校验失败", async () => {
    const result = await createSeason({ ...VALID_INPUT, slug: "INVALID SLUG!" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(result.error.fieldErrors).toBeDefined();
      expect(result.error.fieldErrors!["slug"]).toBeDefined();
    }
  });

  it("starterCount > maxTeamSize 校验失败", async () => {
    const result = await createSeason({ ...VALID_INPUT, starterCount: 10, maxTeamSize: 8 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(result.error.fieldErrors).toBeDefined();
      expect(result.error.fieldErrors!["starterCount"]).toBeDefined();
    }
  });
});

// ── updateSeason ────────────────────────────────────────────────────────────

describe("updateSeason", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuditTracking(insertValuesCalls, updateSetCalls);
    requireSuperAdminMock.mockResolvedValue(superAdminSession);
  });

  it("draft 状态赛季正常更新", async () => {
    seasonsFindFirstMock.mockResolvedValue(draftSeason());

    const result = await updateSeason({ ...VALID_INPUT, id: SEASON_ID });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slug).toBe("test-2026");
    }

    expect(updateSetCalls.length).toBeGreaterThanOrEqual(1);

    expectAuditLog(insertValuesCalls, "season.update", {
      targetId: SEASON_ID,
      targetType: "season",
    });

    expect(revalidatePathMock).toHaveBeenCalledWith("/admin");
  });

  it("赛季不存在返回 fail（SEASON_NOT_FOUND）", async () => {
    seasonsFindFirstMock.mockResolvedValue(undefined);

    const result = await updateSeason({ ...VALID_INPUT, id: NONEXISTENT_ID });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.SEASON_NOT_FOUND);
    }

    expect(updateSetCalls).toHaveLength(0);
  });

  it("尝试修改 slug 返回 fail", async () => {
    seasonsFindFirstMock.mockResolvedValue(draftSeason({ slug: "original-slug" }));

    const result = await updateSeason({ ...VALID_INPUT, id: SEASON_ID, slug: "different-slug" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(result.error.message).toContain("slug");
    }
  });

  it("非 draft 状态下修改核心配置返回 fail", async () => {
    seasonsFindFirstMock.mockResolvedValue(nonDraftSeason("registration"));

    const result = await updateSeason({ ...VALID_INPUT, id: SEASON_ID, maxTeamSize: 10 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.SEASON_INVALID_STATUS);
    }
  });

  it("非 draft 状态下仅修改名称等非核心字段应成功", async () => {
    seasonsFindFirstMock.mockResolvedValue(nonDraftSeason("registration"));

    const result = await updateSeason({ ...VALID_INPUT, id: SEASON_ID, name: "Updated Season Name" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slug).toBe("test-2026");
    }

    expect(updateSetCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ── publishSeason ───────────────────────────────────────────────────────────

describe("publishSeason", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuditTracking(insertValuesCalls, updateSetCalls);
    requireSuperAdminMock.mockResolvedValue(superAdminSession);
  });

  it("draft 状态赛季发布为 registration", async () => {
    seasonsFindFirstMock.mockResolvedValue(draftSeason());

    const result = await publishSeason(SEASON_ID);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slug).toBe("test-2026");
    }

    const statusUpdate = updateSetCalls.find(
      (v) => (v as Record<string, unknown>).status === "registration",
    );
    expect(statusUpdate).toBeDefined();

    expectAuditLog(insertValuesCalls, "season.publish", {
      targetId: SEASON_ID,
      targetType: "season",
    });
    const entry = findAuditEntry(insertValuesCalls, "season.publish");
    expect((entry as { meta: { from: string; to: string } }).meta.from).toBe("draft");
    expect((entry as { meta: { from: string; to: string } }).meta.to).toBe("registration");

    expect(revalidatePathMock).toHaveBeenCalledWith("/admin");
  });

  it("赛季不存在返回 fail（SEASON_NOT_FOUND）", async () => {
    seasonsFindFirstMock.mockResolvedValue(undefined);

    const result = await publishSeason(NONEXISTENT_ID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.SEASON_NOT_FOUND);
    }

    expect(updateSetCalls).toHaveLength(0);
  });

  it("已经发布的状态（非 draft）返回 fail", async () => {
    seasonsFindFirstMock.mockResolvedValue(nonDraftSeason("registration"));

    const result = await publishSeason(SEASON_ID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.SEASON_INVALID_STATUS);
    }

    expect(updateSetCalls).toHaveLength(0);
  });
});

// ── deleteSeason ────────────────────────────────────────────────────────────

describe("deleteSeason", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuditTracking(insertValuesCalls, updateSetCalls);
    requireSuperAdminMock.mockResolvedValue(superAdminSession);

    dbSelectMock.mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ value: 0 }]),
      })),
    }));
  });

  it("draft 状态且无报名记录时正常删除", async () => {
    seasonsFindFirstMock.mockResolvedValue(draftSeason());

    const result = await deleteSeason(SEASON_ID);

    expect(result.success).toBe(true);

    expectAuditLog(insertValuesCalls, "season.deleted", {
      targetId: SEASON_ID,
      targetType: "season",
    });
    const entry = findAuditEntry(insertValuesCalls, "season.deleted");
    expect((entry as { seasonId: string | null }).seasonId).toBeNull();

    expect(revalidatePathMock).toHaveBeenCalledWith("/admin");
  });

  it("赛季不存在返回 fail（SEASON_NOT_FOUND）", async () => {
    seasonsFindFirstMock.mockResolvedValue(undefined);

    const result = await deleteSeason(NONEXISTENT_ID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.SEASON_NOT_FOUND);
    }
  });

  it("非 draft 状态返回 fail", async () => {
    seasonsFindFirstMock.mockResolvedValue(nonDraftSeason("registration"));

    const result = await deleteSeason(SEASON_ID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.SEASON_INVALID_STATUS);
    }
  });

  it("有报名记录时返回 fail", async () => {
    seasonsFindFirstMock.mockResolvedValue(draftSeason());

    dbSelectMock.mockImplementation(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ value: 3 }]),
      })),
    }));

    const result = await deleteSeason(SEASON_ID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.SEASON_INVALID_STATUS);
      expect(result.error.message).toContain("报名");
    }

    expect(findAuditEntry(insertValuesCalls, "season.deleted")).toBeUndefined();
  });
});

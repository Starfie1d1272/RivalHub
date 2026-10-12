import { describe, expect, it, vi } from "vitest";
import { AppError, ErrorCode } from "@/lib/errors";
import { resetAuditTracking } from "tests/helpers";

// ── UUID 常量 ─────────────────────────────────────────────────────────────────
const SEASON_ID = "00000000-0000-0000-0000-000000000001";

// ── hoisted mock 工厂 ───────────────────────────────────────────────────────

const {
  requireSuperAdminMock,
  seasonsFindFirstMock,
  dbInsertMock,
  dbUpdateMock,
  dbDeleteMock,
  dbSelectMock,
  dbExecuteMock,
  dbTransactionMock,
  adminInvitesFindFirstMock,
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
      where: vi.fn(() => {
        // 计数查询直接 await；updateSeason 的行锁链路会继续调用 .for("update")，
        // 此时返回 seasonsFindFirstMock 配置的赛季行。
        const rows = Promise.resolve([{ value: 0 }]);
        return Object.assign(rows, {
          for: vi.fn(async () => {
            const season = await seasonsFindFirstMock();
            return season ? [season] : [];
          }),
        });
      }),
    })),
  }));

  return {
    requireSuperAdminMock: vi.fn(),
    seasonsFindFirstMock: vi.fn(),
    adminInvitesFindFirstMock: vi.fn().mockResolvedValue(undefined),
    dbInsertMock,
    dbUpdateMock,
    dbDeleteMock,
    dbSelectMock,
    dbExecuteMock: vi.fn().mockResolvedValue(undefined),
    dbTransactionMock: vi.fn(),
    insertValuesCalls,
    updateSetCalls,
    revalidatePathMock: vi.fn(),
  };
});

// ── vi.mock ─────────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/session", () => ({
  requireSuperAdmin: requireSuperAdminMock,
  auditActorId: vi.fn((session: { userId: string }) => session.userId),
  requireAuth: vi.fn(),
  requireAdmin: vi.fn(),
  requireSeasonAdmin: vi.fn(),
  getUserSession: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
  updateTag: vi.fn(),
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
    execute: dbExecuteMock,
    transaction: dbTransactionMock,
  },
}));

// 事务 mock：tx 复用同一批 insert/update/delete/select/execute mock，
// 使审计日志断言与事务内行为保持一致。
dbTransactionMock.mockImplementation(async (work: (tx: unknown) => unknown) =>
  work({
    execute: dbExecuteMock,
    query: {
      seasons: { findFirst: seasonsFindFirstMock },
      adminInvites: { findFirst: adminInvitesFindFirstMock },
    },
    insert: dbInsertMock,
    update: dbUpdateMock,
    delete: dbDeleteMock,
    select: dbSelectMock,
  }),
);

// ── 导入被测函数（必须在 vi.mock 之后）────────────────────────────────────

import {
  createSeason,
  updateSeason,
  openSeasonRegistration,
  publishSeason,
  deleteSeason,
  revertSeasonToDraft,
  revertSeasonToRegistration,
  forceFinishSeason,
  archiveSeason,
} from "@/actions/seasons";

const VALID_INPUT = {
  name: "Test Season 2026",
  slug: "test-2026",
  kind: "联赛",
  registrationMode: "solo" as const,
  hasCaptainVoting: true,
  hasDraft: true,
  hasCommunityAwards: true,
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
  registrationOpensAt: null as string | null,
  registrationClosesAt: null as string | null,
  rosterChangeClosesAt: null as string | null,
  endAt: null as string | null,
  themeColor: null as string | null,
};

// ── createSeason ────────────────────────────────────────────────────────────

// ── updateSeason ────────────────────────────────────────────────────────────

// ── openSeasonRegistration ─────────────────────────────────────────────────

// ── publishSeason ───────────────────────────────────────────────────────────

// ── deleteSeason ────────────────────────────────────────────────────────────

describe("season mutation authorization boundary", () => {
  it.each([
    ["create", () => createSeason(VALID_INPUT)],
    ["update", () => updateSeason({ ...VALID_INPUT, id: SEASON_ID })],
    ["publish", () => publishSeason(SEASON_ID)],
    ["delete", () => deleteSeason(SEASON_ID)],
    ["open registration", () => openSeasonRegistration(SEASON_ID)],
    ["revert draft", () => revertSeasonToDraft(SEASON_ID)],
    ["revert registration", () => revertSeasonToRegistration(SEASON_ID)],
    ["finish", () => forceFinishSeason(SEASON_ID)],
    ["archive", () => archiveSeason(SEASON_ID)],
  ] as const)("rejects %s before reads, writes, audit or revalidation", async (_operation, mutate) => {
    vi.clearAllMocks();
    resetAuditTracking(insertValuesCalls, updateSetCalls);
    requireSuperAdminMock.mockRejectedValue(new AppError(ErrorCode.FORBIDDEN, "forbidden"));

    await expect(mutate()).resolves.toMatchObject({ success: false, error: { code: ErrorCode.FORBIDDEN } });
    expect(dbTransactionMock).not.toHaveBeenCalled();
    expect(seasonsFindFirstMock).not.toHaveBeenCalled();
    expect(dbSelectMock).not.toHaveBeenCalled();
    expect(dbInsertMock).not.toHaveBeenCalled();
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(dbDeleteMock).not.toHaveBeenCalled();
    expect(insertValuesCalls).toEqual([]);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";
import { findAuditEntry, mockUserSession, resetAuditTracking } from "tests/helpers";
import type { ActionResult } from "@/types/action";

function errMessage<T>(result: ActionResult<T>): string {
  return result.success ? "" : result.error.message;
}

function errCode<T>(result: ActionResult<T>): string | undefined {
  return result.success ? undefined : result.error.code;
}

// ── hoisted mock 工厂 ────────────────────────────────────────────────────────

const {
  requireSuperAdminMock,
  requireAuthMock,
  dbTransactionMock,
  dbSelectMock,
  dbInsertMock,
  dbUpdateMock,
  dbDeleteMock,
  dbExecuteMock,
  insertValuesCalls,
  updateSetCalls,
  selectResults,
  executeResults,
  revalidatePathMock,
  queryFindFirst,
} = vi.hoisted(() => {
  const insertValuesCalls: unknown[] = [];
  const updateSetCalls: unknown[] = [];
  const selectResults: unknown[] = [];
  const executeResults: Array<Array<Record<string, unknown>>> = [];
  const queryFindFirst = {
    competitivePlatforms: vi.fn(),
    competitivePlatformSeasons: vi.fn(),
    competitivePlatformRanks: vi.fn(),
    competitiveRankFacts: vi.fn(),
  };

  const dbSelectMock = vi.fn(() => {
    const builder: Record<string, unknown> = {};
    builder.from = vi.fn(() => builder);
    builder.where = vi.fn(() => builder);
    builder.orderBy = vi.fn(() => builder);
    builder.limit = vi.fn(() => Promise.resolve(selectResults.shift() ?? []));
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(selectResults.shift() ?? []).then(resolve);
    return builder;
  });

  const dbInsertMock = vi.fn(() => ({
    values: vi.fn((vals: unknown) => {
      insertValuesCalls.push(vals);
      return { returning: vi.fn().mockResolvedValue([{ id: "row-1" }]), then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(undefined)) };
    }),
  }));

  const dbUpdateMock = vi.fn(() => ({
    set: vi.fn((vals: unknown) => {
      updateSetCalls.push(vals);
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
  }));

  const dbDeleteMock = vi.fn(() => ({
    where: vi.fn().mockResolvedValue(undefined),
  }));

  const dbExecuteMock = vi.fn(() => ({
    rows: executeResults.shift() ?? [],
  }));

  return {
    requireSuperAdminMock: vi.fn(),
    requireAuthMock: vi.fn(),
    dbTransactionMock: vi.fn(),
    dbSelectMock,
    dbInsertMock,
    dbUpdateMock,
    dbDeleteMock,
    dbExecuteMock,
    insertValuesCalls,
    updateSetCalls,
    selectResults,
    executeResults,
    revalidatePathMock: vi.fn(),
    queryFindFirst,
  };
});

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...original,
    requireSuperAdmin: requireSuperAdminMock,
    requireAuth: requireAuthMock,
    auditActorId: vi.fn((session: { userId: string }) => session.userId),
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/db/client", () => ({
  db: {
    transaction: dbTransactionMock,
    select: dbSelectMock,
    insert: dbInsertMock,
    update: dbUpdateMock,
    delete: dbDeleteMock,
    execute: dbExecuteMock,
    query: Object.fromEntries(Object.entries(queryFindFirst).map(([key, fn]) => [key, { findFirst: fn }])),
  },
}));

import {
  createCompetitivePlatform,
  createCompetitivePlatformRank,
  createCompetitivePlatformSeason,
  deleteCompetitivePlatformRank,
  deleteCompetitivePlatformSeason,
  moveCompetitivePlatformRank,
  moveCompetitivePlatformSeason,
  setCurrentCompetitivePlatformSeason,
  setCompetitivePlatformSeasonActive,
  updateCompetitivePlatform,
  updateCompetitivePlatformRankLabel,
  updateCompetitivePlatformSeason,
} from "@/actions/competitive-platform";
import { saveCompetitiveProfile } from "@/actions/competitive-profile";

const SEASON_ID = "00000000-0000-0000-0000-0000000000a1";
const RANK_ID = "00000000-0000-0000-0000-0000000000b1";
const UUID_A = "00000000-0000-0000-0000-0000000000c1";
const UUID_B = "00000000-0000-0000-0000-0000000000c2";

function makeTx() {
  return {
    query: Object.fromEntries(Object.entries(queryFindFirst).map(([key, fn]) => [key, { findFirst: fn }])),
    select: dbSelectMock,
    insert: dbInsertMock,
    update: dbUpdateMock,
    delete: dbDeleteMock,
    execute: dbExecuteMock,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuditTracking(insertValuesCalls, updateSetCalls);
  selectResults.length = 0;
  executeResults.length = 0;
  requireSuperAdminMock.mockResolvedValue(mockUserSession({ userId: "admin-1", role: "super_admin", authSource: "user" }));
  dbTransactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx()));
});

// ── 权限 ─────────────────────────────────────────────────────────────────────

describe("catalog action permissions", () => {
  it("rejects non-super-admin operators before touching the database", async () => {
    requireSuperAdminMock.mockRejectedValue(new Error("权限不足"));
    const result = await createCompetitivePlatform({ key: "new_platform", displayName: "新平台" });
    expect(result.success).toBe(false);
    expect(dbTransactionMock).not.toHaveBeenCalled();
    expect(insertValuesCalls).toHaveLength(0);
  });
});

// ── Platform identity ───────────────────────────────────────────────────────

describe("platform identity actions", () => {
  it("creates a platform with an immutable key and writes an audit log", async () => {
    queryFindFirst.competitivePlatforms.mockResolvedValue(undefined);
    const result = await createCompetitivePlatform({ key: "new_platform", displayName: "新平台" });
    expect(result.success).toBe(true);
    const values = insertValuesCalls[0] as { key: string; displayName: string };
    expect(values).toMatchObject({ key: "new_platform", displayName: "新平台" });
    expect(findAuditEntry(insertValuesCalls, "competitive_platform.create")).toMatchObject({ targetId: "new_platform" });
  });

  it("rejects duplicate platform keys", async () => {
    queryFindFirst.competitivePlatforms.mockResolvedValue({ key: "perfect_world", displayName: "完美世界竞技平台" });
    const result = await createCompetitivePlatform({ key: "perfect_world", displayName: "重复平台" });
    expect(result.success).toBe(false);
    expect(errCode(result)).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it("rejects platform keys with characters outside the allowed alphabet", async () => {
    const result = await createCompetitivePlatform({ key: "Bad Key!", displayName: "平台" });
    expect(result.success).toBe(false);
    expect(dbTransactionMock).not.toHaveBeenCalled();
  });

  it("updates only the display name; the key stays immutable", async () => {
    queryFindFirst.competitivePlatforms.mockResolvedValue({ key: "perfect_world", displayName: "旧名称" });
    const result = await updateCompetitivePlatform({ key: "perfect_world", displayName: "新名称" });
    expect(result.success).toBe(true);
    expect(updateSetCalls).toEqual([expect.objectContaining({ displayName: "新名称" })]);
    expect(JSON.stringify(updateSetCalls)).not.toContain("key");
  });
});

// ── Season chronology ───────────────────────────────────────────────────────

describe("season catalog actions", () => {
  it("creates a season with server-assigned chronology and audits it", async () => {
    queryFindFirst.competitivePlatforms.mockResolvedValue({ key: "perfect_world", displayName: "完美世界竞技平台" });
    queryFindFirst.competitivePlatformSeasons.mockResolvedValue(undefined);
    selectResults.push([{ maxOrder: 4 }]);
    const result = await createCompetitivePlatformSeason({ platform: "perfect_world", seasonKey: "S24", label: "S24 赛季" });
    expect(result.success).toBe(true);
    expect(insertValuesCalls[0]).toMatchObject({ platform: "perfect_world", seasonKey: "S24", sortOrder: 5, isCurrent: false, active: true });
    expect(findAuditEntry(insertValuesCalls, "competitive_platform_season.create")).toBeDefined();
  });

  it("refuses to create a season for an unknown platform", async () => {
    queryFindFirst.competitivePlatforms.mockResolvedValue(undefined);
    const result = await createCompetitivePlatformSeason({ platform: "ghost", seasonKey: "S1", label: "S1" });
    expect(result.success).toBe(false);
    expect(errCode(result)).toBe(ErrorCode.NOT_FOUND);
  });

  it("renames the season label without touching seasonKey identity", async () => {
    queryFindFirst.competitivePlatformSeasons.mockResolvedValue({ id: SEASON_ID, platform: "perfect_world", seasonKey: "S24", label: "旧名", isCurrent: false, active: true });
    const result = await updateCompetitivePlatformSeason({ id: SEASON_ID, label: "新名" });
    expect(result.success).toBe(true);
    expect(updateSetCalls).toEqual([expect.objectContaining({ label: "新名" })]);
    expect(JSON.stringify(updateSetCalls)).not.toContain("seasonKey");
  });

  it("cannot deactivate the current season", async () => {
    queryFindFirst.competitivePlatformSeasons.mockResolvedValue({ id: SEASON_ID, platform: "perfect_world", seasonKey: "S24", label: "S24", isCurrent: true, active: true });
    const result = await setCompetitivePlatformSeasonActive({ id: SEASON_ID, active: false });
    expect(result.success).toBe(false);
    expect(errMessage(result)).toContain("当前赛季必须保持启用");
  });

  it("switching current is an explicit transactional action: exactly one current per platform", async () => {
    queryFindFirst.competitivePlatformSeasons
      .mockResolvedValueOnce({ id: SEASON_ID, platform: "perfect_world", seasonKey: "S24", label: "S24", isCurrent: false, active: true })
      .mockResolvedValueOnce({ id: UUID_A, platform: "perfect_world", seasonKey: "S23", label: "S23", isCurrent: true, active: true });
    const result = await setCurrentCompetitivePlatformSeason({ id: SEASON_ID });
    expect(result.success).toBe(true);
    expect(updateSetCalls).toEqual([
      expect.objectContaining({ isCurrent: false }),
      expect.objectContaining({ isCurrent: true }),
    ]);
    const audit = findAuditEntry(insertValuesCalls, "competitive_platform_season.set_current");
    expect(audit?.meta).toMatchObject({ fromSeasonKey: "S23", toSeasonKey: "S24" });
  });

  it("cannot set an inactive season as the current season", async () => {
    queryFindFirst.competitivePlatformSeasons.mockResolvedValue({ id: SEASON_ID, platform: "perfect_world", seasonKey: "S24", label: "S24", isCurrent: false, active: false });
    const result = await setCurrentCompetitivePlatformSeason({ id: SEASON_ID });
    expect(result.success).toBe(false);
    expect(errMessage(result)).toContain("停用的赛季不能设为当前赛季");
  });

  it("reorders chronology through a two-phase swap that cannot hit the unique index", async () => {
    queryFindFirst.competitivePlatformSeasons.mockResolvedValue({ id: SEASON_ID, platform: "perfect_world", seasonKey: "S24", label: "S24", sortOrder: 2, isCurrent: false, active: true });
    selectResults.push([{ id: UUID_B, platform: "perfect_world", seasonKey: "S23", sortOrder: 1, isCurrent: false, active: true }]);
    const result = await moveCompetitivePlatformSeason({ id: SEASON_ID, direction: "up" });
    expect(result.success).toBe(true);
    expect(updateSetCalls.map((call) => (call as { sortOrder?: number }).sortOrder)).toEqual([-1, -2, 1, 2]);
  });

  it("blocks deleting the current season", async () => {
    queryFindFirst.competitivePlatformSeasons.mockResolvedValue({ id: SEASON_ID, platform: "perfect_world", seasonKey: "S24", label: "S24", isCurrent: true, active: true });
    const result = await deleteCompetitivePlatformSeason({ id: SEASON_ID });
    expect(result.success).toBe(false);
    expect(errMessage(result)).toContain("当前赛季");
  });

  it("blocks deleting a season referenced by long-term facts or a frozen event context", async () => {
    queryFindFirst.competitivePlatformSeasons.mockResolvedValue({ id: SEASON_ID, platform: "perfect_world", seasonKey: "S23", label: "S23", isCurrent: false, active: true });
    queryFindFirst.competitiveRankFacts.mockResolvedValue({ id: "fact-1" });
    const factResult = await deleteCompetitivePlatformSeason({ id: SEASON_ID });
    expect(factResult.success).toBe(false);
    expect(errMessage(factResult)).toContain("已有竞技资料引用");

    queryFindFirst.competitiveRankFacts.mockResolvedValue(undefined);
    executeResults.push([{ id: "season-9" }]);
    const frozenResult = await deleteCompetitivePlatformSeason({ id: SEASON_ID });
    expect(frozenResult.success).toBe(false);
    expect(errMessage(frozenResult)).toContain("已发布赛事冻结");
  });

  it("deletes an unreferenced season with an audit log", async () => {
    queryFindFirst.competitivePlatformSeasons.mockResolvedValue({ id: SEASON_ID, platform: "perfect_world", seasonKey: "S23", label: "S23", isCurrent: false, active: true });
    queryFindFirst.competitiveRankFacts.mockResolvedValue(undefined);
    executeResults.push([]);
    const result = await deleteCompetitivePlatformSeason({ id: SEASON_ID });
    expect(result.success).toBe(true);
    expect(findAuditEntry(insertValuesCalls, "competitive_platform_season.delete")).toMatchObject({ targetId: SEASON_ID });
  });
});

// ── Rank ladder ─────────────────────────────────────────────────────────────

describe("rank ladder actions", () => {
  it("creates a rank with a derived stable key and appends it to the top of the ladder", async () => {
    queryFindFirst.competitivePlatforms.mockResolvedValue({ key: "perfect_world", displayName: "完美世界竞技平台" });
    queryFindFirst.competitivePlatformRanks.mockResolvedValue(undefined);
    selectResults.push([{ maxOrder: 3 }]);
    const result = await createCompetitivePlatformRank({ platform: "perfect_world", label: "S+" });
    expect(result.success).toBe(true);
    expect(insertValuesCalls[0]).toMatchObject({ platformKey: "perfect_world", rankKey: "s", label: "S+", sortOrder: 4 });
  });

  it("renames the label; rankKey identity is immutable", async () => {
    queryFindFirst.competitivePlatformRanks.mockResolvedValue({ id: RANK_ID, platformKey: "perfect_world", rankKey: "s_plus", label: "S+", sortOrder: 4 });
    const result = await updateCompetitivePlatformRankLabel({ id: RANK_ID, label: "超级大师" });
    expect(result.success).toBe(true);
    expect(updateSetCalls).toEqual([expect.objectContaining({ label: "超级大师" })]);
    expect(JSON.stringify(updateSetCalls)).not.toContain("rankKey");
  });

  it("fails closed when reordering a referenced rank would rewrite historical semantics", async () => {
    queryFindFirst.competitivePlatformRanks.mockResolvedValue({ id: RANK_ID, platformKey: "perfect_world", rankKey: "s_plus", label: "S+", sortOrder: 4 });
    selectResults.push([{ id: UUID_A, platformKey: "perfect_world", rankKey: "s", label: "S", sortOrder: 3 }]);
    executeResults.push([{ rank: "s_plus" }]);
    const result = await moveCompetitivePlatformRank({ id: RANK_ID, direction: "up" });
    expect(result.success).toBe(false);
    expect(errMessage(result)).toContain("版本化 ladder");
  });

  it("reorders unreferenced ranks with the two-phase unique-safe swap", async () => {
    queryFindFirst.competitivePlatformRanks.mockResolvedValue({ id: RANK_ID, platformKey: "perfect_world", rankKey: "s_plus", label: "S+", sortOrder: 4 });
    selectResults.push([{ id: UUID_A, platformKey: "perfect_world", rankKey: "s", label: "S", sortOrder: 3 }]);
    executeResults.push([]);
    const result = await moveCompetitivePlatformRank({ id: RANK_ID, direction: "up" });
    expect(result.success).toBe(true);
    expect(updateSetCalls.map((call) => (call as { sortOrder?: number }).sortOrder)).toEqual([-1, -2, 3, 4]);
  });

  it("fails closed when deleting a rank referenced by facts or a frozen rank order", async () => {
    queryFindFirst.competitivePlatformRanks.mockResolvedValue({ id: RANK_ID, platformKey: "perfect_world", rankKey: "s_plus", label: "S+", sortOrder: 4 });
    executeResults.push([{ rank: "s" }, { rank: "s_plus" }]);
    const result = await deleteCompetitivePlatformRank({ id: RANK_ID });
    expect(result.success).toBe(false);
    expect(errMessage(result)).toContain("不能删除");
  });

  it("deletes an unreferenced rank", async () => {
    queryFindFirst.competitivePlatformRanks.mockResolvedValue({ id: RANK_ID, platformKey: "perfect_world", rankKey: "temp", label: "临时", sortOrder: 9 });
    executeResults.push([]);
    const result = await deleteCompetitivePlatformRank({ id: RANK_ID });
    expect(result.success).toBe(true);
    expect(findAuditEntry(insertValuesCalls, "competitive_platform_rank.delete")).toMatchObject({ meta: { rankKey: "temp" } });
  });
});

// ── User profile validation ─────────────────────────────────────────────────

describe("saveCompetitiveProfile platform-ladder validation", () => {
  beforeEach(() => {
    requireAuthMock.mockResolvedValue(mockUserSession({ userId: "user-1", role: "user" }));
    dbTransactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx()));
    dbSelectMock.mockImplementation(() => {
      const builder: Record<string, unknown> = {};
      builder.from = vi.fn(() => builder);
      builder.where = vi.fn(() => builder);
      builder.orderBy = vi.fn(() => builder);
      builder.limit = vi.fn(() => Promise.resolve(selectResults.shift() ?? []));
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(selectResults.shift() ?? []).then(resolve);
      return builder;
    });
  });

  function queueLadder({ platform = true, ladder = ["bronze", "silver", "gold"], seasons = ["s20", "s21"] } = {}) {
    dbSelectMock.mockImplementationOnce(() => {
      const builder: Record<string, unknown> = {};
      builder.from = vi.fn(() => builder);
      builder.where = vi.fn(() => builder);
      builder.limit = vi.fn(() => Promise.resolve(platform ? [{ key: "perfect_world" }] : []));
      return builder;
    });
    selectResults.push(ladder.map((rankKey, index) => ({ platformKey: "perfect_world", rankKey, label: rankKey.toUpperCase(), sortOrder: index })));
    selectResults.push(seasons.map((seasonKey) => ({ platform: "perfect_world", seasonKey, label: seasonKey.toUpperCase() })));
    queryFindFirst.competitiveRankFacts.mockResolvedValue(undefined);
  }

  it("stores stable rank keys when they belong to the platform ladder", async () => {
    queueLadder();
    const result = await saveCompetitiveProfile({
      platform: "perfect_world",
      historicalPeak: { rank: "gold", rating: 2100 },
      seasonPeaks: [{ seasonKey: "s21", rank: "silver", rating: 1800 }],
    });
    expect(result.success).toBe(true);
    expect(insertValuesCalls.filter((entry) => (entry as { action?: string }).action)).toEqual([
      expect.objectContaining({ action: "competitive_profile.self_declare" }),
    ]);
  });

  it("rejects ranks outside the platform ladder", async () => {
    queueLadder();
    const result = await saveCompetitiveProfile({
      platform: "perfect_world",
      historicalPeak: { rank: "herald", rating: 100 },
      seasonPeaks: [],
    });
    expect(result.success).toBe(false);
    expect(errMessage(result)).toContain("不在平台段位表中");
  });

  it("rejects seasons outside the platform catalog", async () => {
    queueLadder({ seasons: ["s21"] });
    const result = await saveCompetitiveProfile({
      platform: "perfect_world",
      historicalPeak: { rank: "gold", rating: 2100 },
      seasonPeaks: [{ seasonKey: "s99", rank: "gold", rating: 2100 }],
    });
    expect(result.success).toBe(false);
    expect(errMessage(result)).toContain("不在目录中");
  });

  it("fails closed for an unknown platform", async () => {
    queueLadder({ platform: false });
    const result = await saveCompetitiveProfile({
      platform: "ghost",
      historicalPeak: { rank: "gold", rating: 2100 },
      seasonPeaks: [],
    });
    expect(result.success).toBe(false);
    expect(errMessage(result)).toContain("竞技平台不存在");
  });
});

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
  updateTag: vi.fn(),
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
import { temporarySortOrders } from "@/lib/competitive/catalog";
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
  requireSuperAdminMock.mockResolvedValue(mockUserSession({ userId: "admin-1", role: "super_admin" }));
  dbTransactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx()));
});

// ── 权限 ─────────────────────────────────────────────────────────────────────

describe("catalog action permissions", () => {
  it("rejects non-super-admin operators before touching the database", async () => {
    requireSuperAdminMock.mockRejectedValue(new Error("权限不足"));
    const result = await updateCompetitivePlatform({ key: "perfect_world", displayName: "新名称", ratingLabel: "Rating Pro" });
    expect(result.success).toBe(false);
    expect(dbTransactionMock).not.toHaveBeenCalled();
    expect(insertValuesCalls).toHaveLength(0);
  });
});

// ── Platform identity ───────────────────────────────────────────────────────

describe("platform identity actions", () => {
  it("rejects arbitrary platform identities; 2.0 only maintains built-ins", async () => {
    const result = await updateCompetitivePlatform({ key: "faceit", displayName: "FACEIT", ratingLabel: "Elo" });
    expect(result.success).toBe(false);
    expect(dbTransactionMock).not.toHaveBeenCalled();
    expect(errMessage(result)).toContain("仅维护 Perfect World 与 5E");
  });

  it("updates the display name but can never mutate the product-defined canonical Rating", async () => {
    queryFindFirst.competitivePlatforms.mockResolvedValue({ key: "fivee", displayName: "5E", ratingLabel: "Rating+" });
    const result = await updateCompetitivePlatform({ key: "fivee", displayName: "5E 对战平台", ratingLabel: "Elo" });
    expect(result.success).toBe(true);
    expect(updateSetCalls).toEqual([expect.objectContaining({ displayName: "5E 对战平台" })]);
    expect(JSON.stringify(updateSetCalls)).not.toContain("ratingLabel");
    expect(JSON.stringify(updateSetCalls)).not.toContain("Elo");
    expect(findAuditEntry(insertValuesCalls, "competitive_platform.update")).toMatchObject({ targetId: "fivee" });
  });
});

// ── Season chronology ───────────────────────────────────────────────────────

describe("season catalog actions", () => {
  it("creates a season with normalized identity, transactional chronology and an audit", async () => {
    queryFindFirst.competitivePlatforms.mockResolvedValue({ key: "perfect_world", displayName: "完美世界竞技平台" });
    queryFindFirst.competitivePlatformSeasons.mockResolvedValue(undefined);
    selectResults.push([]);
    const result = await createCompetitivePlatformSeason({ platform: "perfect_world", seasonKey: "S24", label: "S24 赛季" });
    expect(result.success).toBe(true);
    expect(insertValuesCalls[0]).toMatchObject({ platform: "perfect_world", seasonKey: "s24", sortOrder: -2, isCurrent: false, active: true });
    expect(findAuditEntry(insertValuesCalls, "competitive_platform_season.create")).toBeDefined();
  });

  it("rejects a normalized key that collides with a legacy row differing only by case", async () => {
    queryFindFirst.competitivePlatforms.mockResolvedValue({ key: "perfect_world", displayName: "完美世界竞技平台" });
    selectResults.push([{ id: SEASON_ID, platform: "perfect_world", seasonKey: "S24", sortOrder: 10 }]);
    const result = await createCompetitivePlatformSeason({ platform: "perfect_world", seasonKey: "s24", label: "S24 赛季" });
    expect(result.success).toBe(false);
    expect(errMessage(result)).toContain("已存在赛季标识 s24");
    expect(insertValuesCalls).toHaveLength(0);
  });

  it("refuses to create a season for an unknown platform", async () => {
    queryFindFirst.competitivePlatforms.mockResolvedValue(undefined);
    const result = await createCompetitivePlatformSeason({ platform: "ghost", seasonKey: "S1", label: "S1" });
    expect(result.success).toBe(false);
    expect(errCode(result)).toBe(ErrorCode.VALIDATION_FAILED);
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
    selectResults.push(
      [{ id: UUID_B, platform: "perfect_world", seasonKey: "S23", sortOrder: 1, isCurrent: false, active: true }],
      [{ sortOrder: -2 }, { sortOrder: -1 }, { sortOrder: 1 }, { sortOrder: 2 }],
    );
    const result = await moveCompetitivePlatformSeason({ id: SEASON_ID, direction: "earlier" });
    expect(result.success).toBe(true);
    expect(updateSetCalls.map((call) => (call as { sortOrder?: number }).sortOrder)).toEqual([-4, -3, 1, 2]);
  });

  it("blocks deleting the current season", async () => {
    queryFindFirst.competitivePlatformSeasons.mockResolvedValue({ id: SEASON_ID, platform: "perfect_world", seasonKey: "S24", label: "S24", isCurrent: true, active: true });
    const result = await deleteCompetitivePlatformSeason({ id: SEASON_ID });
    expect(result.success).toBe(false);
    expect(errMessage(result)).toContain("当前赛季");
  });

  it("blocks deleting a season referenced by long-term facts (including historical provenance) or a frozen event context", async () => {
    queryFindFirst.competitivePlatformSeasons.mockResolvedValue({ id: SEASON_ID, platform: "perfect_world", seasonKey: "S23", label: "S23", isCurrent: false, active: true });
    queryFindFirst.competitiveRankFacts.mockResolvedValue({ id: "fact-1" });
    const factResult = await deleteCompetitivePlatformSeason({ id: SEASON_ID });
    expect(factResult.success).toBe(false);
    expect(errMessage(factResult)).toContain("已有竞技资料引用");

    queryFindFirst.competitiveRankFacts.mockResolvedValue(undefined);
    executeResults.push([{ id: "season-9" }]);
    const frozenResult = await deleteCompetitivePlatformSeason({ id: SEASON_ID });
    expect(frozenResult.success).toBe(false);
    expect(errMessage(frozenResult)).toContain("已开放报名赛事冻结");
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
  it("requires an explicit stable key and preserves real rank identities", async () => {
    queryFindFirst.competitivePlatforms.mockResolvedValue({ key: "perfect_world", displayName: "完美世界竞技平台" });
    queryFindFirst.competitivePlatformRanks.mockResolvedValue(undefined);
    selectResults.push([{ maxOrder: 3 }]);
    const result = await createCompetitivePlatformRank({ platform: "perfect_world", label: "S+", rankKey: "S+" });
    expect(result.success).toBe(true);
    expect(insertValuesCalls[0]).toMatchObject({ platformKey: "perfect_world", rankKey: "S+", label: "S+", sortOrder: 4 });
    selectResults.push([{ maxOrder: 4 }]);
    expect((await createCompetitivePlatformRank({ platform: "perfect_world", label: "青铜S", rankKey: "青铜S" })).success).toBe(true);
    expect((await createCompetitivePlatformRank({ platform: "perfect_world", label: "C++" })).success).toBe(false);
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
    expect(errMessage(result)).toContain("不能修改");
  });

  it("reorders unreferenced ranks with the two-phase unique-safe swap", async () => {
    queryFindFirst.competitivePlatformRanks.mockResolvedValue({ id: RANK_ID, platformKey: "perfect_world", rankKey: "s_plus", label: "S+", sortOrder: 4 });
    selectResults.push(
      [{ id: UUID_A, platformKey: "perfect_world", rankKey: "s", label: "S", sortOrder: 3 }],
      [],
      [{ sortOrder: -2 }, { sortOrder: -1 }, { sortOrder: 3 }, { sortOrder: 4 }],
    );
    executeResults.push([]);
    const result = await moveCompetitivePlatformRank({ id: RANK_ID, direction: "up" });
    expect(result.success).toBe(true);
    expect(updateSetCalls.map((call) => (call as { sortOrder?: number }).sortOrder)).toEqual([-4, -3, 3, 4]);
  });

  it("fails closed when deleting a rank referenced by facts or a frozen rank order", async () => {
    queryFindFirst.competitivePlatformRanks.mockResolvedValue({ id: RANK_ID, platformKey: "perfect_world", rankKey: "s_plus", label: "S+", sortOrder: 4 });
    executeResults.push([{ rank: "s" }, { rank: "s_plus" }]);
    const result = await deleteCompetitivePlatformRank({ id: RANK_ID });
    expect(result.success).toBe(false);
    expect(errMessage(result)).toContain("不能修改");
  });

  it("deletes an unreferenced rank", async () => {
    queryFindFirst.competitivePlatformRanks.mockResolvedValue({ id: RANK_ID, platformKey: "perfect_world", rankKey: "temp", label: "临时", sortOrder: 9 });
    executeResults.push([]);
    const result = await deleteCompetitivePlatformRank({ id: RANK_ID });
    expect(result.success).toBe(true);
    expect(findAuditEntry(insertValuesCalls, "competitive_platform_rank.delete")).toMatchObject({ meta: { rankKey: "temp" } });
  });
});

describe("catalog ordering helper", () => {
  it("always reserves unused temporary positions below a four-item chronology", () => {
    expect(temporarySortOrders([-2, -1, 0, 1])).toEqual([-4, -3]);
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

  function queueLadder({ platform = true, ladder = ["bronze", "silver", "gold"] as Array<string | { rankKey: string; starMin: number | null; starMax: number | null }>, seasons = ["s20", "s21"], existingFacts = [] as Array<{ id: string; kind: string; platformSeasonKey: string | null; rank: string; rating: string; stars: number | null }> } = {}) {
    dbSelectMock.mockImplementationOnce(() => {
      const builder: Record<string, unknown> = {};
      builder.from = vi.fn(() => builder);
      builder.where = vi.fn(() => builder);
      builder.limit = vi.fn(() => Promise.resolve(platform ? [{ key: "perfect_world" }] : []));
      return builder;
    });
    selectResults.push(ladder.map((item, index) => {
      const rank = typeof item === "string" ? { rankKey: item, starMin: null, starMax: null } : item;
      return { platformKey: "perfect_world", rankKey: rank.rankKey, label: rank.rankKey.toUpperCase(), sortOrder: index, starMin: rank.starMin, starMax: rank.starMax };
    }));
    selectResults.push(seasons.map((seasonKey) => ({ platform: "perfect_world", seasonKey, label: seasonKey.toUpperCase() })));
    selectResults.push(existingFacts);
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

  it("persists explicit unranked without fabricating a rank and removes an explicit unrecorded fact", async () => {
    queueLadder({ existingFacts: [{ id: "old-season", kind: "season_peak", platformSeasonKey: "s20", rank: "silver", rating: "1800", stars: null }] });
    const result = await saveCompetitiveProfile({
      platform: "perfect_world",
      historicalPeak: { rank: "gold", rating: 2100, achievedSeasonKey: "s21" },
      seasonPeaks: [
        { seasonKey: "s20", status: "unrecorded" },
        { seasonKey: "s21", status: "unranked", rating: null },
      ],
    });
    expect(result.success).toBe(true);
    expect(insertValuesCalls).toContainEqual(expect.objectContaining({ status: "unranked", rank: null, rating: null, stars: null }));
    expect(dbDeleteMock).toHaveBeenCalled();
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

  it("requires integral non-negative stars before any database work", async () => {
    const fractional = await saveCompetitiveProfile({
      platform: "perfect_world", historicalPeak: { rank: "gold", rating: 2100, stars: 10.5 }, seasonPeaks: [],
    });
    const negative = await saveCompetitiveProfile({
      platform: "perfect_world", historicalPeak: { rank: "gold", rating: 2100, stars: -1 }, seasonPeaks: [],
    });
    expect(fractional.success).toBe(false);
    expect(negative.success).toBe(false);
    expect(dbTransactionMock).not.toHaveBeenCalled();
  });

  it("passes an untouched legacy null-stars fact through without fabricating stars", async () => {
    queueLadder({
      ladder: [{ rankKey: "黄金S", starMin: 10, starMax: 24 }],
      existingFacts: [{ id: "fact-1", kind: "historical_peak", platformSeasonKey: null, rank: "黄金S", rating: "2100.00", stars: null }],
    });
    const result = await saveCompetitiveProfile({
      platform: "perfect_world", historicalPeak: { rank: "黄金S", rating: 2100, stars: null }, seasonPeaks: [],
    });
    expect(result.success).toBe(true);
    expect(updateSetCalls).toEqual([expect.objectContaining({ rank: "黄金S", rating: "2100", stars: null })]);
    expect(insertValuesCalls.filter((entry) => (entry as { action?: string }).action)).toEqual([
      expect.objectContaining({ action: "competitive_profile.self_declare" }),
    ]);
  });

  it("rejects a real edit of a legacy fact and a fresh star fact until stars are supplied", async () => {
    queueLadder({
      ladder: [{ rankKey: "黄金S", starMin: 10, starMax: 24 }],
      existingFacts: [{ id: "fact-1", kind: "historical_peak", platformSeasonKey: null, rank: "黄金S", rating: "2100.00", stars: null }],
    });
    const edited = await saveCompetitiveProfile({
      platform: "perfect_world", historicalPeak: { rank: "黄金S", rating: 2200, stars: null }, seasonPeaks: [],
    });
    expect(edited.success).toBe(false);
    expect(errMessage(edited)).toContain("需要填写准确星数");

    queueLadder({ ladder: [{ rankKey: "黄金S", starMin: 10, starMax: 24 }] });
    const fresh = await saveCompetitiveProfile({
      platform: "perfect_world", historicalPeak: { rank: "黄金S", rating: 2100, stars: null }, seasonPeaks: [],
    });
    expect(fresh.success).toBe(false);
    expect(errMessage(fresh)).toContain("需要填写准确星数");
  });

  it("rejects stars on a non-star rank and requires them on star ranks", async () => {
    queueLadder();
    const nonStar = await saveCompetitiveProfile({
      platform: "perfect_world", historicalPeak: { rank: "gold", rating: 2100, stars: 1 }, seasonPeaks: [],
    });
    expect(nonStar.success).toBe(false);
    expect(errMessage(nonStar)).toContain("不使用星数");

    queueLadder({ ladder: [{ rankKey: "黄金S", starMin: 10, starMax: 24 }] });
    const missing = await saveCompetitiveProfile({
      platform: "perfect_world", historicalPeak: { rank: "黄金S", rating: 2100, stars: null }, seasonPeaks: [],
    });
    expect(missing.success).toBe(false);
    expect(errMessage(missing)).toContain("需要填写准确星数");
  });

  it("accepts exact Perfect and 5E-style finite/open star boundaries without changing rating payload", async () => {
    const ranks = [
      { rankKey: "青铜S", starMin: 0, starMax: 9 },
      { rankKey: "黄金S", starMin: 10, starMax: 24 },
      { rankKey: "钻石S", starMin: 25, starMax: 49 },
      { rankKey: "魔王S", starMin: 50, starMax: null },
      { rankKey: "S", starMin: 0, starMax: 19 },
      { rankKey: "SS", starMin: 20, starMax: 39 },
      { rankKey: "SSS", starMin: 40, starMax: null },
    ];
    queueLadder({ ladder: ranks });
    const perfect = await saveCompetitiveProfile({
      platform: "perfect_world", historicalPeak: { rank: "黄金S", rating: 2100, stars: 24 }, seasonPeaks: [{ seasonKey: "s21", rank: "魔王S", rating: 2200, stars: 50 }],
    });
    expect(perfect.success).toBe(true);
    expect(insertValuesCalls.some((entry) => (entry as { stars?: number }).stars === 24)).toBe(true);

    queueLadder({ ladder: ranks });
    const invalid = await saveCompetitiveProfile({
      platform: "perfect_world", historicalPeak: { rank: "SS", rating: 2100, stars: 40 }, seasonPeaks: [],
    });
    expect(invalid.success).toBe(false);
    expect(errMessage(invalid)).toContain("20–39");
  });
});

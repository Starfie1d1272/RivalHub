import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";

// ── hoisted mock refs ──────────────────────────────────────────────────────────
const matchesFindFirstMock = vi.hoisted(() => vi.fn());
const seasonsFindFirstMock = vi.hoisted(() => vi.fn());
const matchMapsFindFirstMock = vi.hoisted(() => vi.fn());
const txMatchMapsFindManyMock = vi.hoisted(() => vi.fn());
const txUpdateMock = vi.hoisted(() => vi.fn());
const txInsertMock = vi.hoisted(() => vi.fn());
const txSelectMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());
const requireSeasonAdminMock = vi.hoisted(() => vi.fn());
const auditActorIdMock = vi.hoisted(() => vi.fn());
const revalidateMatchPathsMock = vi.hoisted(() => vi.fn());

const matchesUpdateSetCalls: unknown[] = [];
const matchMapsUpdateSetCalls: unknown[] = [];
const txInsertValuesCalls: unknown[] = [];

vi.mock("@/db/client", () => {
  const tx = {
    query: {
      matchMaps: { findMany: txMatchMapsFindManyMock },
    },
    update: txUpdateMock,
    insert: txInsertMock,
    select: txSelectMock,
  };
  return {
    db: {
      query: {
        matches: { findFirst: matchesFindFirstMock },
        seasons: { findFirst: seasonsFindFirstMock },
        matchMaps: { findFirst: matchMapsFindFirstMock },
      },
      transaction: transactionMock.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx)),
    },
  };
});

vi.mock("@/lib/auth/session", () => ({
  requireSeasonAdmin: requireSeasonAdminMock,
  auditActorId: auditActorIdMock,
}));

vi.mock("@/lib/revalidation", () => ({
  revalidateMatchPaths: revalidateMatchPathsMock,
}));

// ── import after mocks ─────────────────────────────────────────────────────────
import { correctMatchScore, correctMapScore } from "@/actions/matches/results";
import { matches, matchMaps } from "@/db/schema";

// ── helpers ─────────────────────────────────────────────────────────────────────
function setupSeason() {
  seasonsFindFirstMock.mockResolvedValue({
    id: "season-1",
    slug: "spring-2026",
    stagePlan: "[]",
    registrationConfig: "{}",
  });
}

function setupMatch(overrides?: Record<string, unknown>) {
  matchesFindFirstMock.mockResolvedValue({
    id: "match-1",
    seasonId: "season-1",
    entryAId: "team-a",
    entryBId: "team-b",
    stage: "playoff",
    round: 1,
    format: "bo3",
    scoreA: 2,
    scoreB: 1,
    status: "finished",
    bracketNodeId: null,
    ...overrides,
  });
}

function setupAdminSession() {
  requireSeasonAdminMock.mockResolvedValue({
    userId: "admin-1",
    email: "admin@test.com",
  });
  auditActorIdMock.mockImplementation(
    (session: { userId: string; email: string }) => session.email ?? session.userId,
  );
}

function setupTxWriteMocks() {
  txSelectMock.mockImplementation(() => {
    const result = {
      from: () => result,
      where: () => result,
      for: () => Promise.resolve([{ status: "playing" }]),
    };
    return result;
  });
  txUpdateMock.mockImplementation((table: unknown) => ({
    set: vi.fn((values: unknown) => {
      if (table === matchMaps) matchMapsUpdateSetCalls.push(values);
      else if (table === matches) matchesUpdateSetCalls.push(values);
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
  }));
  txInsertMock.mockImplementation(() => ({
    values: vi.fn((values: unknown) => {
      txInsertValuesCalls.push(values);
      return Promise.resolve();
    }),
  }));
}

function setupMapRecord(overrides?: Record<string, unknown>) {
  matchMapsFindFirstMock.mockResolvedValue({
    id: "m1",
    matchId: "match-1",
    mapOrder: 1,
    mapName: "de_inferno",
    pickedByEntryId: null,
    teamAStartSide: "t",
    scoreA: 13,
    scoreB: 8,
    completedAt: new Date("2026-06-01T10:00:00Z"),
    ...overrides,
  });
}

function setupTxMaps(maps: { id: string; scoreA: number; scoreB: number }[]) {
  txMatchMapsFindManyMock.mockResolvedValue(
    maps.map((m) => ({
      matchId: "match-1",
      mapName: `map-${m.id}`,
      pickedByEntryId: null,
      teamAStartSide: "t",
      completedAt: new Date(),
      ...m,
    })),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
describe("correctMatchScore — winner guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    matchesUpdateSetCalls.length = 0;
    matchMapsUpdateSetCalls.length = 0;
    txInsertValuesCalls.length = 0;
    setupSeason();
    setupAdminSession();
    setupTxWriteMocks();
  });

  it("BO3 same winner correction (2:0 → 2:1) → success + audit", async () => {
    setupMatch({ format: "bo3", scoreA: 2, scoreB: 0 });

    const result = await correctMatchScore("match-1", 2, 1);

    expect(result.success).toBe(true);
    expect(matchesUpdateSetCalls).toContainEqual({
      scoreA: 2,
      scoreB: 1,
      updatedAt: expect.any(Date),
    });
    expect(
      txInsertValuesCalls.some(
        (v) => (v as { action: string }).action === "match.correct_score",
      ),
    ).toBe(true);
  });

  it("BO3 winner-changing correction (2:1 → 1:2) → reject without writes", async () => {
    setupMatch({ format: "bo3", scoreA: 2, scoreB: 1 });

    const result = await correctMatchScore("match-1", 1, 2);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(result.error.message).toContain("改变比赛胜者");
    }
    expect(matchesUpdateSetCalls).toEqual([]);
    expect(txInsertValuesCalls).toEqual([]);
  });

  it("BO1 same winner correction (13:8 → 16:14) → success", async () => {
    setupMatch({ format: "bo1", scoreA: 13, scoreB: 8 });

    const result = await correctMatchScore("match-1", 16, 14);

    expect(result.success).toBe(true);
    expect(matchesUpdateSetCalls).toContainEqual({
      scoreA: 16,
      scoreB: 14,
      updatedAt: expect.any(Date),
    });
  });

  it("BO1 winner-changing correction (13:8 → 8:13) → reject without writes", async () => {
    setupMatch({ format: "bo1", scoreA: 13, scoreB: 8 });

    const result = await correctMatchScore("match-1", 8, 13);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("改变比赛胜者");
    }
    expect(matchesUpdateSetCalls).toEqual([]);
    expect(txInsertValuesCalls).toEqual([]);
  });

  it("BO1 illegal MR12 score still rejected (14:13)", async () => {
    setupMatch({ format: "bo1", scoreA: 13, scoreB: 8 });

    const result = await correctMatchScore("match-1", 14, 13);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.MATCH_INVALID_SCORE);
    }
    expect(matchesUpdateSetCalls).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("correctMapScore — shared legality + winner guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    matchesUpdateSetCalls.length = 0;
    matchMapsUpdateSetCalls.length = 0;
    txInsertValuesCalls.length = 0;
    setupSeason();
    setupAdminSession();
    setupTxWriteMocks();
  });

  it("legal MR12 round score + series winner unchanged → success", async () => {
    setupMatch({ format: "bo3", scoreA: 2, scoreB: 1 });
    setupMapRecord({ id: "m1" });
    setupTxMaps([
      { id: "m1", scoreA: 13, scoreB: 8 },
      { id: "m2", scoreA: 13, scoreB: 10 },
      { id: "m3", scoreA: 8, scoreB: 13 },
    ]);

    const result = await correctMapScore("m1", 16, 14);

    expect(result.success).toBe(true);
    // 单图比分更新
    expect(matchMapsUpdateSetCalls).toContainEqual({ scoreA: 16, scoreB: 14 });
    // 系列赛保持 2:1（A 胜），仅按重算结果重写
    expect(matchesUpdateSetCalls).toContainEqual({
      scoreA: 2,
      scoreB: 1,
      updatedAt: expect.any(Date),
    });
    expect(
      txInsertValuesCalls.some(
        (v) => (v as { action: string }).action === "match.correct_map_score",
      ),
    ).toBe(true);
  });

  it("illegal MR12 round score (14:13) → reject without writes", async () => {
    setupMatch({ format: "bo3", scoreA: 2, scoreB: 1 });
    setupMapRecord({ id: "m1" });
    setupTxMaps([
      { id: "m1", scoreA: 13, scoreB: 8 },
      { id: "m2", scoreA: 13, scoreB: 10 },
      { id: "m3", scoreA: 8, scoreB: 13 },
    ]);

    const result = await correctMapScore("m1", 14, 13);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.MATCH_INVALID_SCORE);
    }
    expect(matchMapsUpdateSetCalls).toEqual([]);
    expect(matchesUpdateSetCalls).toEqual([]);
    expect(txInsertValuesCalls).toEqual([]);
  });

  it("map correction causes series winner change → reject without writes", async () => {
    // 当前 2:1（A 胜）；把 m2 从 A 胜改成 B 胜 → 1:2（B 胜）
    setupMatch({ format: "bo3", scoreA: 2, scoreB: 1 });
    setupMapRecord({ id: "m2" });
    setupTxMaps([
      { id: "m1", scoreA: 13, scoreB: 8 },
      { id: "m2", scoreA: 13, scoreB: 10 },
      { id: "m3", scoreA: 8, scoreB: 13 },
    ]);

    const result = await correctMapScore("m2", 8, 13);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("改变比赛胜者");
    }
    expect(matchMapsUpdateSetCalls).toEqual([]);
    expect(matchesUpdateSetCalls).toEqual([]);
    expect(txInsertValuesCalls).toEqual([]);
  });

  it("recomputed series becomes unresolved (1:1) → reject without writes", async () => {
    // 当前 2:0（A 胜）；把 m2 从 A 胜改成 B 胜 → 1:1，系列赛未完结
    setupMatch({ format: "bo3", scoreA: 2, scoreB: 0 });
    setupMapRecord({ id: "m2" });
    setupTxMaps([
      { id: "m1", scoreA: 13, scoreB: 8 },
      { id: "m2", scoreA: 13, scoreB: 10 },
    ]);

    const result = await correctMapScore("m2", 8, 13);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("无法构成完整比分");
    }
    expect(matchMapsUpdateSetCalls).toEqual([]);
    expect(matchesUpdateSetCalls).toEqual([]);
    expect(txInsertValuesCalls).toEqual([]);
  });

  it("BO1 correction keeps canonical match-level map-count representation (1:0)", async () => {
    // recordMapResult 对 BO1 的 match.scoreA/scoreB 存的是地图胜数（1:0），不是回合数（13:8）
    setupMatch({ format: "bo1", scoreA: 1, scoreB: 0 });
    setupMapRecord({ id: "m1" });
    setupTxMaps([{ id: "m1", scoreA: 13, scoreB: 8 }]);

    const result = await correctMapScore("m1", 16, 14);

    expect(result.success).toBe(true);
    expect(matchMapsUpdateSetCalls).toContainEqual({ scoreA: 16, scoreB: 14 });
    // 系列赛仍按地图胜数保存为 1:0，而不是回合数 16:14
    expect(matchesUpdateSetCalls).toContainEqual({
      scoreA: 1,
      scoreB: 0,
      updatedAt: expect.any(Date),
    });
  });

  it("BO1 map correction changing map winner → reject", async () => {
    setupMatch({ format: "bo1", scoreA: 1, scoreB: 0 });
    setupMapRecord({ id: "m1" });
    setupTxMaps([{ id: "m1", scoreA: 13, scoreB: 8 }]);

    const result = await correctMapScore("m1", 8, 13);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain("改变比赛胜者");
    }
    expect(matchMapsUpdateSetCalls).toEqual([]);
    expect(matchesUpdateSetCalls).toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const matchMapsFindFirstMock = vi.hoisted(() => vi.fn());
const matchesFindFirstMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());
const loadScoreboardPlayersMock = vi.hoisted(() => vi.fn());
const loadOperatorScoreboardMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/matches/operator-scoreboard", () => ({ loadScoreboardPlayers: loadScoreboardPlayersMock, clearOperatorScoreboardInTx: vi.fn(), loadOperatorScoreboard: loadOperatorScoreboardMock }));
vi.mock("@/lib/observability/server", () => ({ captureException: vi.fn() }));
const updatePublicStatsTagMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/revalidation", () => ({ updatePublicStatsTag: updatePublicStatsTagMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const requireSeasonAdminMock = vi.hoisted(() => vi.fn());
const auditActorIdMock = vi.hoisted(() => vi.fn(() => "admin@local.test"));
const writeAuditInTxMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/audit/write", () => ({ writeAuditInTx: writeAuditInTxMock }));

vi.mock("@/db/client", () => ({
  db: {
    query: {
      matchMaps: { findFirst: matchMapsFindFirstMock },
      matches: { findFirst: matchesFindFirstMock },
    },
    transaction: transactionMock,
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireSeasonAdmin: requireSeasonAdminMock,
  auditActorId: auditActorIdMock,
  requireAuth: vi.fn(),
}));

import { getPlayerStatsByMap, savePlayerStats } from "@/actions/player-stats";
import { ErrorCode } from "@/lib/errors";

describe("savePlayerStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    matchMapsFindFirstMock.mockResolvedValue({ id: "map-1", matchId: "match-1", scoreA: null, scoreB: null, completedAt: null });
  });

  it("fails closed before authorization or writes when the map has not finished", async () => {
    matchMapsFindFirstMock.mockResolvedValue({ id: "map-1", matchId: "match-1", scoreA: 13, scoreB: 9, completedAt: null });
    matchesFindFirstMock.mockResolvedValue({ id: "match-1", seasonId: "season-1", status: "in_progress" });

    const result = await savePlayerStats("map-1", { rows: [] });

    expect(result).toEqual({ success: false, error: { code: ErrorCode.MATCH_INVALID_TRANSITION, message: "只有已结束的地图可以确认选手数据。" } });
    expect(requireSeasonAdminMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("operator scoreboard identity boundary", () => {
  beforeEach(() => vi.clearAllMocks());
  const userId = "10000000-0000-4000-8000-000000000001";
  const draft = { perfectName: "Player", userId, kills: 10, deaths: 5, assists: 2, hsPercent: 50, firstKills: 1, multiKills: 1, clutches: 0, adr: 80, ratingPro: 1.2, rws: 7, we: 8 };

  it("rejects malformed, unmatched and duplicate identities before persistence", async () => {
    for (const rows of [[{ ...draft, userId: "invalid" }], [{ ...draft, userId: null }], [draft, { ...draft, perfectName: "Different" }], [{ ...draft, kills: "10" }]]) {
      const result = await savePlayerStats("map-1", { rows: rows as Parameters<typeof savePlayerStats>[1]["rows"] });
      expect(result.success).toBe(false);
    }
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects a well-formed user outside the match roster inside the transaction", async () => {
    const completedAt = new Date("2026-09-29T00:00:00.000Z");
    matchMapsFindFirstMock.mockResolvedValue({ id: "map-1", matchId: "match-1", scoreA: 13, scoreB: 9, completedAt });
    matchesFindFirstMock.mockResolvedValue({ id: "match-1", seasonId: "season-1", entryAId: "entry-a", entryBId: "entry-b", status: "in_progress" });
    loadScoreboardPlayersMock.mockResolvedValue([]);
    const select = vi.fn()
      .mockReturnValueOnce({ from: () => ({ where: () => ({ for: async () => [{ id: "match-1" }] }) }) })
      .mockReturnValueOnce({ from: () => ({ where: () => ({ for: async () => [{ scoreA: 13, scoreB: 9, completedAt }] }) }) });
    const tx = { select, insert: vi.fn(), update: vi.fn(), delete: vi.fn() };
    transactionMock.mockImplementation(async callback => callback(tx));
    const result = await savePlayerStats("map-1", { rows: [draft] });
    expect(result).toMatchObject({ success: false, error: { code: ErrorCode.VALIDATION_FAILED, message: "选手不属于本场出场阵容" } });
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.delete).not.toHaveBeenCalled();
  });

  it("lets OCR enrich only Rating/RWS/WE on a DAK-owned row", async () => {
    const completedAt = new Date("2026-09-29T00:00:00.000Z");
    matchMapsFindFirstMock.mockResolvedValue({ id: "map-1", matchId: "match-1", scoreA: 13, scoreB: 9, completedAt });
    matchesFindFirstMock.mockResolvedValue({ id: "match-1", seasonId: "season-1", entryAId: "entry-a", entryBId: "entry-b", status: "in_progress" });
    requireSeasonAdminMock.mockResolvedValue({ userId: "admin", email: "admin@local.test" });
    loadScoreboardPlayersMock.mockResolvedValue([{ userId, perfectName: "Player" }]);

    const dakRow = {
      id: "stat-1",
      matchId: "match-1",
      mapId: "map-1",
      perfectName: "Demo Snapshot",
      userId,
      kills: 20,
      deaths: 10,
      assists: 5,
      hsPercent: 50,
      firstKills: 2,
      firstDeaths: 1,
      multiKills: 3,
      tradeKills: 4,
      kastRounds: 20,
      clutches: 1,
      adr: 85,
      ratingPro: 1.1,
      rws: 6,
      we: 7,
      dakImportId: "import-1",
      verifiedByAdmin: "dak-verifier",
      verifiedAt: new Date("2026-09-28T00:00:00.000Z"),
      createdAt: new Date("2026-09-28T00:00:00.000Z"),
    };

    const select = vi.fn()
      .mockReturnValueOnce({ from: () => ({ where: () => ({ for: async () => [{ id: "match-1" }] }) }) })
      .mockReturnValueOnce({ from: () => ({ where: () => ({ for: async () => [{ scoreA: 13, scoreB: 9, completedAt }] }) }) })
      .mockReturnValueOnce({ from: () => ({ where: () => ({ for: async () => [dakRow] }) }) });
    const updateValues: Record<string, unknown>[] = [];
    const tx = {
      select,
      insert: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => {
          updateValues.push(values);
          return { where: vi.fn().mockResolvedValue(undefined) };
        }),
      })),
    };
    transactionMock.mockImplementation(async callback => callback(tx));

    const result = await savePlayerStats("map-1", {
      rows: [{ ...draft, ratingPro: 1.3, rws: 8, we: 9 }],
    });

    expect(result).toMatchObject({ success: true });
    expect(updateValues).toEqual([{ ratingPro: 1.3, rws: 8, we: 9 }]);
    expect(updateValues[0]).not.toHaveProperty("userId");
    expect(updateValues[0]).not.toHaveProperty("perfectName");
    expect(updateValues[0]).not.toHaveProperty("verifiedByAdmin");
    expect(updateValues[0]).not.toHaveProperty("verifiedAt");
    expect(writeAuditInTxMock).toHaveBeenCalledTimes(1);
  });
});

describe("operator scoreboard read boundary", () => {
  const readRow = { perfectName: "Demo Player", userId: "10000000-0000-4000-8000-000000000001", kills: 20, deaths: 10, assists: 5, hsPercent: 50, firstKills: 2, multiKills: 1, clutches: 0, adr: 80, rws: 7, ratingPro: 1.2, we: 8, gameplayLocked: true };

  beforeEach(() => {
    vi.clearAllMocks();
    matchMapsFindFirstMock.mockResolvedValue({ id: "map-1", matchId: "match-1" });
    matchesFindFirstMock.mockResolvedValue({ id: "match-1", seasonId: "season-1" });
    requireSeasonAdminMock.mockResolvedValue({ userId: "admin" });
    loadOperatorScoreboardMock.mockResolvedValue([readRow]);
  });

  it("authorizes the owning season before returning the sanitized read model unchanged", async () => {
    const rows = await getPlayerStatsByMap("map-1");

    expect(requireSeasonAdminMock).toHaveBeenCalledWith("season-1");
    expect(loadOperatorScoreboardMock).toHaveBeenCalledTimes(1);
    expect(loadOperatorScoreboardMock.mock.calls[0]?.slice(1)).toEqual(["map-1"]);
    expect(rows).toEqual([readRow]);
  });

  it("fails closed without reading any row when the caller is not a season admin", async () => {
    requireSeasonAdminMock.mockRejectedValue(new Error("forbidden"));

    const rows = await getPlayerStatsByMap("map-1");

    expect(rows).toEqual([]);
    expect(loadOperatorScoreboardMock).not.toHaveBeenCalled();
  });

  it("does not reach the read model when the map is unknown", async () => {
    matchMapsFindFirstMock.mockResolvedValue(undefined);

    expect(await getPlayerStatsByMap("map-1")).toEqual([]);
    expect(requireSeasonAdminMock).not.toHaveBeenCalled();
    expect(loadOperatorScoreboardMock).not.toHaveBeenCalled();
  });
});

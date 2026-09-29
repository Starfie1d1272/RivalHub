import { beforeEach, describe, expect, it, vi } from "vitest";

const matchMapsFindFirstMock = vi.hoisted(() => vi.fn());
const matchesFindFirstMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());
const loadScoreboardPlayersMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/matches/operator-scoreboard", () => ({ loadScoreboardPlayers: loadScoreboardPlayersMock, clearOperatorScoreboardInTx: vi.fn() }));

const requireSeasonAdminMock = vi.hoisted(() => vi.fn());

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
  auditActorId: vi.fn(),
  requireAuth: vi.fn(),
}));

import { savePlayerStats } from "@/actions/player-stats";
import { ErrorCode } from "@/lib/errors";

describe("savePlayerStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    matchMapsFindFirstMock.mockResolvedValue({ id: "map-1", matchId: "match-1", scoreA: null, scoreB: null });
  });

  it("fails closed before authorization or writes when the map has not finished", async () => {
    matchesFindFirstMock.mockResolvedValue({ id: "match-1", seasonId: "season-1", status: "scheduled" });

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

  it("rejects malformed and duplicate identities before persistence", async () => {
    for (const rows of [[{ ...draft, userId: "invalid" }], [draft, { ...draft, perfectName: "Different" }], [{ ...draft, kills: "10" }]]) {
      const result = await savePlayerStats("map-1", { rows: rows as Parameters<typeof savePlayerStats>[1]["rows"] });
      expect(result.success).toBe(false);
    }
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects a well-formed user outside the match roster inside the transaction", async () => {
    matchMapsFindFirstMock.mockResolvedValue({ id: "map-1", matchId: "match-1", scoreA: 13, scoreB: 9 });
    matchesFindFirstMock.mockResolvedValue({ id: "match-1", seasonId: "season-1", entryAId: "entry-a", entryBId: "entry-b", status: "in_progress" });
    loadScoreboardPlayersMock.mockResolvedValue([]);
    const select = vi.fn()
      .mockReturnValueOnce({ from: () => ({ where: () => ({ for: async () => [{ id: "match-1" }] }) }) })
      .mockReturnValueOnce({ from: () => ({ where: () => ({ for: async () => [{ scoreA: 13, scoreB: 9 }] }) }) });
    const tx = { select, insert: vi.fn(), update: vi.fn(), delete: vi.fn() };
    transactionMock.mockImplementation(async callback => callback(tx));
    const result = await savePlayerStats("map-1", { rows: [draft] });
    expect(result).toMatchObject({ success: false, error: { code: ErrorCode.VALIDATION_FAILED, message: "选手不属于本场出场阵容" } });
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.delete).not.toHaveBeenCalled();
  });
});

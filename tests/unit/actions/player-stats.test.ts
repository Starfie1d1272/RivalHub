import { beforeEach, describe, expect, it, vi } from "vitest";

const matchMapsFindFirstMock = vi.hoisted(() => vi.fn());
const matchesFindFirstMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());
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
    matchMapsFindFirstMock.mockResolvedValue({ id: "map-1", matchId: "match-1" });
  });

  it("fails closed before authorization or writes when the match has not finished", async () => {
    matchesFindFirstMock.mockResolvedValue({ id: "match-1", seasonId: "season-1", status: "scheduled" });

    const result = await savePlayerStats("map-1", { rows: [] });

    expect(result).toEqual({ success: false, error: { code: ErrorCode.MATCH_INVALID_TRANSITION, message: "只有已结束比赛可以确认选手数据。" } });
    expect(requireSeasonAdminMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

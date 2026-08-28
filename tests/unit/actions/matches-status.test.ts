import { beforeEach, describe, expect, it, vi } from "vitest";

const matchFindFirstMock = vi.hoisted(() => vi.fn());
const seasonFindFirstMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());
const requireSeasonAdminMock = vi.hoisted(() => vi.fn());
const auditActorIdMock = vi.hoisted(() => vi.fn());
const applyMatchStatusTransitionMock = vi.hoisted(() => vi.fn());
const maybeFinishSeasonMock = vi.hoisted(() => vi.fn());
const revalidateMatchPathsMock = vi.hoisted(() => vi.fn());

vi.mock("@/db/client", () => ({
  db: {
    query: {
      matches: { findFirst: matchFindFirstMock },
      seasons: { findFirst: seasonFindFirstMock },
    },
    transaction: transactionMock,
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireSeasonAdmin: requireSeasonAdminMock,
  auditActorId: auditActorIdMock,
}));

vi.mock("@/lib/match-rosters/service", () => ({
  applyMatchStatusTransitionInTx: applyMatchStatusTransitionMock,
}));

vi.mock("@/actions/transitions", () => ({
  maybeFinishSeason: maybeFinishSeasonMock,
}));

vi.mock("@/lib/revalidation", () => ({
  revalidateMatchPaths: revalidateMatchPathsMock,
}));

import { updateMatchStatus } from "@/actions/matches/results";

describe("updateMatchStatus season finalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    matchFindFirstMock.mockResolvedValue({
      id: "match-1",
      seasonId: "season-1",
      status: "scheduled",
    });
    seasonFindFirstMock.mockResolvedValue({ id: "season-1", slug: "rivals" });
    requireSeasonAdminMock.mockResolvedValue({ userId: "admin-1", email: "admin@test.com" });
    auditActorIdMock.mockReturnValue("admin-1");
    applyMatchStatusTransitionMock.mockResolvedValue(undefined);
    maybeFinishSeasonMock.mockResolvedValue(undefined);
    transactionMock.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({}));
  });

  it("checks season completion after cancelling the last non-Swiss match", async () => {
    const result = await updateMatchStatus("match-1", "cancelled");

    expect(result.success).toBe(true);
    expect(applyMatchStatusTransitionMock).toHaveBeenCalledWith(
      expect.anything(),
      { matchId: "match-1", nextStatus: "cancelled", actorId: "admin-1" },
    );
    expect(maybeFinishSeasonMock).toHaveBeenCalledWith(expect.anything(), "season-1");
  });

  it("does not invoke generic season completion while starting a match", async () => {
    const result = await updateMatchStatus("match-1", "in_progress");

    expect(result.success).toBe(true);
    expect(maybeFinishSeasonMock).not.toHaveBeenCalled();
  });
});

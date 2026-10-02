import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { castMatchMvpVote } from "@/actions/player-stats";

const { select, transaction, requireAuth, revalidatePath, updatePublicStatsTag } = vi.hoisted(() => ({
  select: vi.fn(), transaction: vi.fn(), requireAuth: vi.fn(),
  revalidatePath: vi.fn(), updatePublicStatsTag: vi.fn(),
}));
vi.mock("@/db/client", () => ({ db: { select, transaction } }));
vi.mock("@/lib/auth/session", () => ({ requireAuth, requireSeasonAdmin: vi.fn(), auditActorId: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/revalidation", () => ({ updatePublicStatsTag }));
vi.mock("@/lib/observability/server", () => ({ captureException: vi.fn() }));

describe("MVP vote acceptance lock", () => {
  const completedAt = new Date("2026-10-01T12:00:00Z");
  const beforeDeadline = new Date("2026-10-02T11:59:59Z");
  function fixture() {
    const lock = vi.fn().mockResolvedValue([{ id: "match-1", status: "finished", completedAt, mvpWinnerUserId: null }]);
    const candidateQuery: Record<string, unknown> = {};
    candidateQuery.innerJoin = vi.fn(() => candidateQuery);
    candidateQuery.where = vi.fn().mockResolvedValue([{ userId: "player-1", playerName: "Player" }]);
    const insert = vi.fn().mockResolvedValue(undefined);
    const tx = {
      select: vi.fn()
        .mockReturnValueOnce({ from: () => ({ where: () => ({ for: lock }) }) })
        .mockReturnValue({ from: () => candidateQuery }),
      insert: vi.fn(() => ({ values: insert })),
    };
    transaction.mockImplementation(async work => work(tx));
    return { lock, insert };
  }
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(beforeDeadline);
    requireAuth.mockResolvedValue({ userId: "voter-1" });
    select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ createdAt: new Date("2026-09-01T00:00:00Z") }] }) }) });
  });
  afterEach(() => vi.useRealTimers());

  it("accepts the vote inside a shared match lock and invalidates after commit", async () => {
    const f = fixture();
    expect(await castMatchMvpVote("match-1", "player-1")).toEqual({ success: true, data: undefined });
    expect(f.lock).toHaveBeenCalledWith("share");
    expect(f.insert).toHaveBeenCalledWith({ matchId: "match-1", playerUserId: "player-1", playerName: "Player", voterUserId: "voter-1" });
    expect(updatePublicStatsTag).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/[seasonSlug]/matches/[matchId]", "page");
  });

  it("checks the deadline after waiting for the match lock", async () => {
    const f = fixture();
    f.lock.mockImplementation(async () => {
      vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
      return [{ id: "match-1", status: "finished", completedAt, mvpWinnerUserId: null }];
    });
    expect(await castMatchMvpVote("match-1", "player-1")).toMatchObject({ success: false, error: { message: "MVP 投票已截止" } });
    expect(f.insert).not.toHaveBeenCalled();
    expect(updatePublicStatsTag).not.toHaveBeenCalled();
  });

  it("rejects a vote after a winner was locked even if match time was later corrected", async () => {
    const f = fixture();
    f.lock.mockResolvedValue([{ id: "match-1", status: "finished", completedAt, mvpWinnerUserId: "player-2" }]);
    expect(await castMatchMvpVote("match-1", "player-1")).toMatchObject({ success: false, error: { message: "MVP 投票已截止" } });
    expect(f.insert).not.toHaveBeenCalled();
  });
});

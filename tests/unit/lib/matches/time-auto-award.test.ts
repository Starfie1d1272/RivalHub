/** Scheduling transitions/locks are proven by match-time-scheduling.test.ts in
 * PostgreSQL. This unit protects worker failure accounting for scheduler health. */
import { beforeEach, expect, it, vi } from "vitest";
const { proposals, transaction } = vi.hoisted(() => ({
  proposals: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@/db/client", () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(async () => []) })) })),
    query: { matchTimeProposals: { findMany: proposals } },
    transaction,
  },
}));
import { runMatchTimeAutoAwardCron } from "@/lib/matches/time-auto-award";
beforeEach(() => { vi.clearAllMocks(); });
it("reports an empty timeout queue without creating work", async () => {
  proposals.mockResolvedValue([]);
  expect(await runMatchTimeAutoAwardCron()).toEqual({
    processed: 0, awarded: 0, skipped: 0, failed: 0, affectedMatches: [],
  });
  expect(transaction).not.toHaveBeenCalled();
});
it("keeps one failed proposal visible to scheduler health while accounting for other outcomes", async () => {
  proposals.mockResolvedValue([{ id: "failed", matchId: "one" }, { id: "skipped", matchId: "two" }, { id: "awarded", matchId: "three" }]);
  transaction.mockRejectedValueOnce(new Error("database unavailable"))
    .mockResolvedValueOnce({ awarded: false, matchId: "two" })
    .mockResolvedValueOnce({ awarded: true, matchId: "three", seasonSlug: "season" });
  expect(await runMatchTimeAutoAwardCron()).toEqual({
    processed: 3, awarded: 1, skipped: 1, failed: 1,
    affectedMatches: [{ seasonSlug: "season", matchId: "three" }],
  });
});

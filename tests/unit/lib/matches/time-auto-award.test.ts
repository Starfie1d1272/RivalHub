/** Scheduling transitions/locks are proven by match-time-scheduling.test.ts in
 * PostgreSQL. This unit protects worker failure accounting for scheduler health. */
import { beforeEach, expect, it, vi } from "vitest";
const { proposals, transaction, dueLineups } = vi.hoisted(() => ({
  proposals: vi.fn(), transaction: vi.fn(), dueLineups: vi.fn(),
}));
vi.mock("@/db/client", () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: dueLineups })) })),
    query: { matchTimeProposals: { findMany: proposals } },
    transaction,
  },
}));
import { runMatchTimeAutoAwardCron } from "@/lib/matches/time-auto-award";
beforeEach(() => { vi.clearAllMocks(); dueLineups.mockResolvedValue([]); });
it("reports an empty timeout queue without creating work", async () => {
  proposals.mockResolvedValue([]);
  expect(await runMatchTimeAutoAwardCron()).toEqual({
    processed: 0, awarded: 0, skipped: 0, failed: 0, affectedMatches: [], lineups: { created: 0, blocked: 0, failed: 0 }, lineupFailures: [], lineupRequestId: expect.any(String),
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
    affectedMatches: [{ seasonSlug: "season", matchId: "three" }], lineups: { created: 0, blocked: 0, failed: 0 }, lineupFailures: [], lineupRequestId: expect.any(String),
  });
});

// Failure classification protects health without alerting on legitimate waiting.
import { AppError, ErrorCode } from "@/lib/errors";
import * as observability from "@/lib/observability/server";
it("keeps eligibility rejection quiet but retains internal and PG failures", async () => {
  const capture = vi.spyOn(observability, "captureException");
  dueLineups.mockResolvedValue([{ id: "blocked" }, { id: "internal" }, { id: "pg" }]);
  proposals.mockResolvedValue([]);
  const internal = new AppError(ErrorCode.INTERNAL_ERROR, "missing frozen facts");
  const pg = new Error("query failed", { cause: { code: "42P01", message: "private SQL" } });
  transaction.mockRejectedValueOnce(new AppError(ErrorCode.VALIDATION_FAILED, "not eligible"))
    .mockRejectedValueOnce(internal).mockRejectedValueOnce(pg);
  const result = await runMatchTimeAutoAwardCron();
  expect(result.lineups).toEqual({ created: 0, blocked: 1, failed: 2 });
  expect(result.lineupFailures).toEqual([internal, pg]);
  expect(capture).toHaveBeenCalledTimes(2);
  expect(capture).toHaveBeenLastCalledWith("match.default_lineup.failure", pg,
    expect.objectContaining({ requestId: result.lineupRequestId }));
  capture.mockRestore();
});

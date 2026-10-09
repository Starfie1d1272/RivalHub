import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  runMatchTimeAutoAwardCronMock,
  revalidateMatchPathsMock,
  settleExpiredMatchMvpVotesMock,
  reconcileMissingStatisticsProjectionsMock,
  revalidatePublicStatsTagMock,
} = vi.hoisted(() => ({
  runMatchTimeAutoAwardCronMock: vi.fn(),
  revalidateMatchPathsMock: vi.fn(),
  settleExpiredMatchMvpVotesMock: vi.fn(),
  reconcileMissingStatisticsProjectionsMock: vi.fn(),
  revalidatePublicStatsTagMock: vi.fn(),
}));

vi.mock("@/lib/steam-profiles", () => ({ refreshSteamProfiles: vi.fn().mockResolvedValue({ processed: 2, updated: 1, unresolved: 0 }) }));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/seasons/transitions", () => ({ maybeAdvanceFromRegistration: vi.fn() }));
vi.mock("@/lib/draft/operations", () => ({ runDraftTimeoutCron: vi.fn() }));
vi.mock("@/lib/matches/time-auto-award", () => ({
  runMatchTimeAutoAwardCron: runMatchTimeAutoAwardCronMock,
}));
vi.mock("@/lib/education/retention", () => ({ purgeExpiredEducationEvidence: vi.fn() }));
vi.mock("@/lib/matches/mvp", () => ({ settleExpiredMatchMvpVotes: settleExpiredMatchMvpVotesMock }));
vi.mock("@/lib/stats/projection-backfill", () => ({ reconcileMissingStatisticsProjections: reconcileMissingStatisticsProjectionsMock }));
vi.mock("@/lib/seasons/registration-recovery", () => ({ ensureRegistrationOpenForParticipantInTx: vi.fn() }));
vi.mock("@/lib/revalidation", () => ({
  revalidateMatchPaths: revalidateMatchPathsMock,
  revalidatePublicStatsTag: revalidatePublicStatsTagMock,
  revalidatePublicSeasonTags: vi.fn(),
  revalidateSeasonPaths: vi.fn(),
}));

import { runMatchMvpSettlementJob, runMatchTimeAutoAwardJob, runStatisticsProjectionRebuildJob, runSteamProfileRefreshJob } from "@/lib/scheduler/runners";

describe("scheduler match time auto-award runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invalidates only matches whose MVP winner was committed", async () => {
    settleExpiredMatchMvpVotesMock.mockResolvedValue({
      processed: 2, settled: 1, failures: [], affectedMatches: [{ seasonSlug: "spring", matchId: "match-1" }],
    });
    expect(await runMatchMvpSettlementJob()).toEqual({ result: { processed: 2, settled: 1 }, businessTransitions: 1 });
    expect(revalidateMatchPathsMock).toHaveBeenCalledExactlyOnceWith("spring", "match-1", { mode: "route" });
  });

  it("refreshes statistics only when missing projections were rebuilt", async () => {
    const summary = { candidates: 2, scanned: 2, rebuilt: 1, invalid: 0, skipped: 1, failed: 0 };
    reconcileMissingStatisticsProjectionsMock.mockResolvedValue(summary);
    expect(await runStatisticsProjectionRebuildJob()).toEqual({ result: summary, businessTransitions: 1 });
    expect(revalidatePublicStatsTagMock).toHaveBeenCalledTimes(1);
    revalidatePublicStatsTagMock.mockClear();
    reconcileMissingStatisticsProjectionsMock.mockResolvedValue({ ...summary, rebuilt: 0 });
    await runStatisticsProjectionRebuildJob();
    expect(revalidatePublicStatsTagMock).not.toHaveBeenCalled();
  });

  it("reports projection rebuild failures after invalidating committed successes", async () => {
    reconcileMissingStatisticsProjectionsMock.mockResolvedValue({ candidates: 2, scanned: 2, rebuilt: 1, invalid: 0, skipped: 0, failed: 1 });
    await expect(runStatisticsProjectionRebuildJob()).rejects.toThrow("Failed to rebuild 1 statistics projections");
    expect(revalidatePublicStatsTagMock).toHaveBeenCalledTimes(1);
  });

  it("also invalidates when an invalid source is moved out of public statistics", async () => {
    const summary = { candidates: 1, scanned: 1, rebuilt: 0, invalid: 1, skipped: 0, failed: 0 };
    reconcileMissingStatisticsProjectionsMock.mockResolvedValue(summary);
    expect(await runStatisticsProjectionRebuildJob()).toEqual({ result: summary, businessTransitions: 1 });
    expect(revalidatePublicStatsTagMock).toHaveBeenCalledTimes(1);
  });

  it("invalidates committed MVP results before reporting a partial failure", async () => {
    settleExpiredMatchMvpVotesMock.mockResolvedValue({
      processed: 2, settled: 1, failures: [new Error("database unavailable")],
      affectedMatches: [{ seasonSlug: "spring", matchId: "match-1" }],
    });
    await expect(runMatchMvpSettlementJob()).rejects.toThrow("MVP settlement failed");
    expect(revalidateMatchPathsMock).toHaveBeenCalledExactlyOnceWith("spring", "match-1", { mode: "route" });
  });

  it("refreshes official Steam profile cache without reporting a business transition", async () => {
    expect(await runSteamProfileRefreshJob()).toEqual({ result: { processed: 2, updated: 1, unresolved: 0 }, businessTransitions: 0 });
  });

  it("revalidates affected matches outside the core operation and returns the public summary", async () => {
    runMatchTimeAutoAwardCronMock.mockResolvedValue({
      processed: 3,
      awarded: 2,
      skipped: 1,
      failed: 0,
      affectedMatches: [
        { seasonSlug: "spring", matchId: "match-1" },
        { seasonSlug: "spring", matchId: "match-2" },
      ],
    });

    const result = await runMatchTimeAutoAwardJob();

    expect(runMatchTimeAutoAwardCronMock).toHaveBeenCalledWith();
    expect(revalidateMatchPathsMock).toHaveBeenNthCalledWith(1, "spring", "match-1", { mode: "route" });
    expect(revalidateMatchPathsMock).toHaveBeenNthCalledWith(2, "spring", "match-2", { mode: "route" });
    expect(result).toEqual({
      result: { processed: 3, awarded: 2, skipped: 1, failed: 0 },
      businessTransitions: 2,
    });
  });
});

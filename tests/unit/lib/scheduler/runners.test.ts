import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  runMatchTimeAutoAwardCronMock,
  revalidateMatchPathsMock,
} = vi.hoisted(() => ({
  runMatchTimeAutoAwardCronMock: vi.fn(),
  revalidateMatchPathsMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({ seasons: { status: "seasons.status" } }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/seasons/transitions", () => ({ maybeAdvanceFromRegistration: vi.fn() }));
vi.mock("@/lib/draft/operations", () => ({ runDraftTimeoutCron: vi.fn() }));
vi.mock("@/lib/matches/time-auto-award", () => ({
  runMatchTimeAutoAwardCron: runMatchTimeAutoAwardCronMock,
}));
vi.mock("@/lib/education/retention", () => ({ purgeExpiredEducationEvidence: vi.fn() }));
vi.mock("@/lib/seasons/registration-recovery", () => ({ ensureRegistrationOpenForParticipantInTx: vi.fn() }));
vi.mock("@/lib/revalidation", () => ({
  revalidateMatchPaths: revalidateMatchPathsMock,
  revalidatePublicSeasonTags: vi.fn(),
  revalidateSeasonPaths: vi.fn(),
}));

import { runMatchTimeAutoAwardJob } from "@/lib/scheduler/runners";

describe("scheduler match time auto-award runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    expect(runMatchTimeAutoAwardCronMock).toHaveBeenCalledWith(expect.any(Date));
    expect(revalidateMatchPathsMock).toHaveBeenNthCalledWith(1, "spring", "match-1", { mode: "route" });
    expect(revalidateMatchPathsMock).toHaveBeenNthCalledWith(2, "spring", "match-2", { mode: "route" });
    expect(result).toEqual({
      result: { processed: 3, awarded: 2, skipped: 1, failed: 0 },
      businessTransitions: 2,
    });
  });
});

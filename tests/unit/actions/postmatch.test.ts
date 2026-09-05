import { beforeEach, describe, expect, it, vi } from "vitest";

const matchesFindFirstMock = vi.hoisted(() => vi.fn());
const seasonsFindFirstMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());
const requireSeasonAdminMock = vi.hoisted(() => vi.fn());
const auditActorIdMock = vi.hoisted(() => vi.fn());
const setMatchVideoUrlInTxMock = vi.hoisted(() => vi.fn());
const revalidateMatchPathsMock = vi.hoisted(() => vi.fn());

vi.mock("@/db/client", () => ({
  db: {
    query: {
      matches: { findFirst: matchesFindFirstMock },
      seasons: { findFirst: seasonsFindFirstMock },
    },
    transaction: transactionMock,
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireSeasonAdmin: requireSeasonAdminMock,
  auditActorId: auditActorIdMock,
}));

vi.mock("@/lib/postmatch/service", () => ({
  addMatchCommentatorInTx: vi.fn(),
  removeMatchCommentatorInTx: vi.fn(),
  revokePostMatchSubmissionInTx: vi.fn(),
  setMatchVideoUrlInTx: setMatchVideoUrlInTxMock,
  submitPostMatchReportInTx: vi.fn(),
}));

vi.mock("@/lib/revalidation", () => ({
  revalidateMatchPaths: revalidateMatchPathsMock,
}));

import { updateMatchVideoUrl } from "@/actions/postmatch";

describe("post-match action revalidation", () => {
  const matchId = "00000000-0000-0000-0000-000000000001";

  beforeEach(() => {
    vi.clearAllMocks();
    matchesFindFirstMock.mockResolvedValue({ id: matchId, seasonId: "season-1" });
    seasonsFindFirstMock.mockResolvedValue({ slug: "major" });
    requireSeasonAdminMock.mockResolvedValue({ userId: "admin-1" });
    auditActorIdMock.mockReturnValue("admin-1");
    setMatchVideoUrlInTxMock.mockResolvedValue(undefined);
    transactionMock.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({}));
  });

  it("refreshes the canonical overview and workbench paths after a video update", async () => {
    const result = await updateMatchVideoUrl({
      matchId,
      videoUrl: "https://video.example/match",
    });

    expect(result.success).toBe(true);
    expect(revalidateMatchPathsMock).toHaveBeenCalledWith("major", matchId);
  });
});

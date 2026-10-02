import { beforeEach, describe, expect, it, vi } from "vitest";

const matchesFindFirstMock = vi.hoisted(() => vi.fn());
const seasonsFindFirstMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());
const requireSeasonAdminMock = vi.hoisted(() => vi.fn());
const auditActorIdMock = vi.hoisted(() => vi.fn());
const setMatchVideoUrlInTxMock = vi.hoisted(() => vi.fn());
const claimMatchCommentaryInTxMock = vi.hoisted(() => vi.fn());
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
  claimMatchCommentaryInTx: claimMatchCommentaryInTxMock,
  removeMatchCommentatorInTx: vi.fn(),
  revokePostMatchSubmissionInTx: vi.fn(),
  setMatchVideoUrlInTx: setMatchVideoUrlInTxMock,
  submitPostMatchReportInTx: vi.fn(),
}));

vi.mock("@/lib/revalidation", () => ({
  revalidateMatchPaths: revalidateMatchPathsMock,
}));

import { claimMatchCommentary, updateMatchVideoUrl } from "@/actions/postmatch";
import { AppError, ErrorCode } from "@/lib/errors";

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

  it("claims only for the authenticated user and refreshes the shared match views", async () => {
    auditActorIdMock.mockReturnValue("a-different-audit-identity");
    expect(await claimMatchCommentary({ matchId })).toEqual({ success: true, data: undefined });
    expect(requireSeasonAdminMock).toHaveBeenCalledWith("season-1");
    expect(claimMatchCommentaryInTxMock).toHaveBeenCalledWith({}, { matchId, userId: "admin-1" });
    expect(revalidateMatchPathsMock).toHaveBeenCalledWith("major", matchId);
  });

  it("rejects attempts to supply another claimant or season before reaching persistence", async () => {
    for (const input of [{ matchId, userId: matchId }, { matchId, seasonId: matchId }, { matchId: "invalid" }]) {
      expect(await claimMatchCommentary(input)).toMatchObject({ success: false, error: { code: "VALIDATION_FAILED" } });
    }
    expect(transactionMock).not.toHaveBeenCalled();
    expect(requireSeasonAdminMock).not.toHaveBeenCalled();
  });

  it.each([ErrorCode.UNAUTHORIZED, ErrorCode.FORBIDDEN])("does not write when season authorization fails with %s", async (code) => {
    requireSeasonAdminMock.mockRejectedValueOnce(new AppError(code, "无权认领本场比赛。"));
    expect(await claimMatchCommentary({ matchId })).toMatchObject({ success: false, error: { code } });
    expect(transactionMock).not.toHaveBeenCalled();
    expect(revalidateMatchPathsMock).not.toHaveBeenCalled();
  });

  it("preserves a transactional rejection without a success refresh", async () => {
    claimMatchCommentaryInTxMock.mockRejectedValueOnce(new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "比赛已经结束。"));
    expect(await claimMatchCommentary({ matchId })).toMatchObject({ success: false, error: { code: "MATCH_INVALID_TRANSITION" } });
    expect(revalidateMatchPathsMock).not.toHaveBeenCalled();
  });
});

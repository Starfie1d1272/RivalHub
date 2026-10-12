import { beforeEach, describe, expect, it, vi } from "vitest";

const matchesFindFirstMock = vi.hoisted(() => vi.fn());
const seasonsFindFirstMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());
const requireSeasonAdminMock = vi.hoisted(() => vi.fn());
const auditActorIdMock = vi.hoisted(() => vi.fn());
const revokePostMatchSubmissionInTxMock = vi.hoisted(() => vi.fn());
const setMatchVideoUrlInTxMock = vi.hoisted(() => vi.fn());
const cancelMatchCommentaryInTxMock = vi.hoisted(() => vi.fn());
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
  cancelMatchCommentaryInTx: cancelMatchCommentaryInTxMock,
  claimMatchCommentaryInTx: claimMatchCommentaryInTxMock,
  removeMatchCommentatorInTx: vi.fn(),
  revokePostMatchSubmissionInTx: revokePostMatchSubmissionInTxMock,
  setMatchVideoUrlInTx: setMatchVideoUrlInTxMock,
  submitPostMatchReportInTx: vi.fn(),
}));

vi.mock("@/lib/revalidation", () => ({
  revalidateMatchPaths: revalidateMatchPathsMock,
}));

import { cancelMatchCommentary, claimMatchCommentary } from "@/actions/postmatch";
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

  it("cancels only as the session user, rejects forged identities and preserves authorization failures", async () => {
    expect(await cancelMatchCommentary({ matchId })).toEqual({ success: true, data: undefined });
    expect(cancelMatchCommentaryInTxMock).toHaveBeenCalledExactlyOnceWith({}, { matchId, userId: "admin-1" });
    expect(revalidateMatchPathsMock).toHaveBeenCalledWith("major", matchId);
    vi.clearAllMocks();
    for (const input of [{ matchId, userId: matchId }, { matchId, seasonId: matchId }, { matchId: "invalid" }]) {
      expect(await cancelMatchCommentary(input)).toMatchObject({ success: false, error: { code: "VALIDATION_FAILED" } });
    }
    for (const code of [ErrorCode.UNAUTHORIZED, ErrorCode.FORBIDDEN]) {
      requireSeasonAdminMock.mockRejectedValueOnce(new AppError(code, "无权操作。"));
      expect(await cancelMatchCommentary({ matchId })).toMatchObject({ success: false, error: { code } });
    }
    expect(transactionMock).not.toHaveBeenCalled();
    expect(revalidateMatchPathsMock).not.toHaveBeenCalled();
    cancelMatchCommentaryInTxMock.mockRejectedValueOnce(new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "请联系管理员。"));
    expect(await cancelMatchCommentary({ matchId })).toMatchObject({ success: false, error: { code: "MATCH_INVALID_TRANSITION" } });
    expect(revalidateMatchPathsMock).not.toHaveBeenCalled();
  });

  it.each([ErrorCode.UNAUTHORIZED, ErrorCode.FORBIDDEN])("does not write when season authorization fails with %s", async (code) => {
    requireSeasonAdminMock.mockRejectedValueOnce(new AppError(code, "无权认领本场比赛。"));
    expect(await claimMatchCommentary({ matchId })).toMatchObject({ success: false, error: { code } });
    expect(transactionMock).not.toHaveBeenCalled();
    expect(revalidateMatchPathsMock).not.toHaveBeenCalled();
  });

});

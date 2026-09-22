import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getUserSessionMock,
  requireSuperAdminMock,
  auditActorIdMock,
  submitFeedbackInTxMock,
  setFeedbackStatusInTxMock,
  transactionMock,
  selectMock,
  seasonLookupMock,
  revalidatePathMock,
  selectChain,
} = vi.hoisted(() => {
  const seasonLookupMock = vi.fn();
  const selectChain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: seasonLookupMock,
  };
  selectChain.from.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);
  return {
    getUserSessionMock: vi.fn(),
    requireSuperAdminMock: vi.fn(),
    auditActorIdMock: vi.fn(() => "admin-id"),
    submitFeedbackInTxMock: vi.fn(),
    setFeedbackStatusInTxMock: vi.fn(),
    transactionMock: vi.fn(),
    selectMock: vi.fn(),
    seasonLookupMock,
    revalidatePathMock: vi.fn(),
    selectChain,
  };
});

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/auth/session", () => ({
  auditActorId: auditActorIdMock,
  getUserSession: getUserSessionMock,
  requireSuperAdmin: requireSuperAdminMock,
}));
vi.mock("@/lib/feedback/commands", () => ({
  setFeedbackStatusInTx: setFeedbackStatusInTxMock,
  submitFeedbackInTx: submitFeedbackInTxMock,
}));
vi.mock("@/db/client", () => ({
  db: {
    select: selectMock,
    transaction: transactionMock,
  },
}));

import { submitFeedback } from "@/actions/feedback";

const SEASON_ID = "11111111-1111-4111-8111-111111111111";

describe("feedback action trust boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserSessionMock.mockResolvedValue(null);
    submitFeedbackInTxMock.mockResolvedValue({ accepted: true, id: "feedback-id" });
    transactionMock.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({}));
    selectMock.mockReturnValue(selectChain);
    seasonLookupMock.mockResolvedValue([{ id: SEASON_ID, slug: "spring-2026" }]);
  });

  it("silently accepts a honeypot hit without opening a session or database transaction", async () => {
    await expect(submitFeedback({
      category: "problem",
      body: "自动化提交内容",
      pathname: "/spring-2026/matches",
      seasonId: SEASON_ID,
      honeypot: "filled-by-bot",
    })).resolves.toEqual({ success: true, data: { accepted: true } });

    expect(getUserSessionMock).not.toHaveBeenCalled();
    expect(selectMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
    expect(submitFeedbackInTxMock).not.toHaveBeenCalled();
  });

  it("persists the season only when the submitted id matches the trusted pathname slug", async () => {
    await submitFeedback({
      category: "problem",
      body: "赛事页面加载失败",
      pathname: "/spring-2026/matches",
      seasonId: SEASON_ID,
    });

    expect(submitFeedbackInTxMock).toHaveBeenCalledWith({}, expect.objectContaining({ seasonId: SEASON_ID }));

    vi.clearAllMocks();
    getUserSessionMock.mockResolvedValue(null);
    submitFeedbackInTxMock.mockResolvedValue({ accepted: true, id: "feedback-id" });
    transactionMock.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({}));
    selectMock.mockReturnValue(selectChain);
    seasonLookupMock.mockResolvedValue([{ id: SEASON_ID, slug: "another-season" }]);

    await submitFeedback({
      category: "problem",
      body: "伪造赛事上下文",
      pathname: "/spring-2026/matches",
      seasonId: SEASON_ID,
    });

    expect(submitFeedbackInTxMock).toHaveBeenCalledWith({}, expect.objectContaining({ seasonId: null }));
  });

  it("rejects an unsafe pathname before querying or writing", async () => {
    await expect(submitFeedback({
      category: "problem",
      body: "不要写入外部 URL",
      pathname: "https://evil.example/feedback",
      seasonId: SEASON_ID,
    })).resolves.toMatchObject({ success: false, error: { code: "VALIDATION_FAILED" } });

    expect(selectMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

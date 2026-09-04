import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, ErrorCode } from "@/lib/errors";

const {
  requireAuthMock,
  auditActorIdMock,
  transactionMock,
  expressRecruitmentInterestInTxMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  auditActorIdMock: vi.fn(),
  transactionMock: vi.fn(),
  expressRecruitmentInterestInTxMock: vi.fn(),
}));

const TX = {};

vi.mock("@/lib/auth/session", () => ({
  requireAuth: requireAuthMock,
  auditActorId: auditActorIdMock,
}));
vi.mock("@/db/client", () => ({ db: { transaction: transactionMock } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/recruitment/commands", () => ({
  closeTeamRecruitmentInTx: vi.fn(),
  closePlayerLftInTx: vi.fn(),
  dismissRecruitmentInterestInTx: vi.fn(),
  expressRecruitmentInterestInTx: expressRecruitmentInterestInTxMock,
  upsertPlayerLftInTx: vi.fn(),
  upsertTeamRecruitmentInTx: vi.fn(),
  withdrawRecruitmentInterestInTx: vi.fn(),
}));

import { expressRecruitmentInterest } from "@/actions/recruitment";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const INTENT_ID = "22222222-2222-4222-8222-222222222222";

describe("Recruitment interest error mapping", () => {
  let consoleErrorMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ userId: USER_ID, email: "player@example.com" });
    auditActorIdMock.mockReturnValue(USER_ID);
    transactionMock.mockImplementation((callback: (tx: unknown) => unknown) => callback(TX));
    consoleErrorMock = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorMock.mockRestore();
  });

  it("passes through the canonical duplicate-interest AppError", async () => {
    expressRecruitmentInterestInTxMock.mockRejectedValue(
      new AppError(ErrorCode.REGISTRATION_DUPLICATE, "你已表达过加入意向。"),
    );

    const result = await expressRecruitmentInterest({ recruitmentIntentId: INTENT_ID });

    expect(result).toEqual({ success: false, error: { code: ErrorCode.REGISTRATION_DUPLICATE, message: "你已表达过加入意向。" } });
    expect(consoleErrorMock).not.toHaveBeenCalled();
  });

  it("does not turn an unrelated wrapped unique error into a duplicate-interest message", async () => {
    expressRecruitmentInterestInTxMock.mockRejectedValue({
      cause: { code: "23505", constraint: "teams_slug_unique" },
    });

    const result = await expressRecruitmentInterest({ recruitmentIntentId: INTENT_ID });

    expect(result).toEqual({ success: false, error: { code: ErrorCode.INTERNAL_ERROR, message: "服务器内部错误，请稍后重试" } });
    expect(consoleErrorMock).toHaveBeenCalledOnce();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";
import { mockUserSession, createFakeSeason, createFakeRegistration, findAuditEntry, expectAuditLog, resetAuditTracking } from "tests/helpers";

// ── 合法 UUID 常量 ─────────────────────────────────────────────────────────────
const SEASON_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID_1 = "22222222-2222-2222-2222-222222222222";
const USER_ID_2 = "33333333-3333-3333-3333-333333333333";
const VOTER_REG_ID = "44444444-4444-4444-4444-444444444444";
const CANDIDATE_REG_ID = "55555555-5555-5555-5555-555555555555";
const VOTE_ID = "66666666-6666-6666-6666-666666666666";

// ── hoisted mock refs ──────────────────────────────────────────────────────────
const {
  requireAuthMock,
  // tx 内部 mock fns（transaction 回调里的 tx 对象成员）
  txRegFindFirstMock,
  txSeasonFindFirstMock,
  txCaptainVoteFindFirstMock,
  txSelectMock,
  txInsertMock,
  txDeleteMock,
  // 事务外 db mock
  dbInsertMock,
  dbRegFindFirstMock,
  dbSeasonFindFirstMock,
  // 记录写入的 audit 条目
  insertValuesCalls,
  // 其他 mock
  validateCaptainVoteMock,
  revalidateSeasonPathsMock,
} = vi.hoisted(() => {
  const insertValuesCalls: unknown[] = [];
  return {
    requireAuthMock: vi.fn(),
    txRegFindFirstMock: vi.fn(),
    txSeasonFindFirstMock: vi.fn(),
    txCaptainVoteFindFirstMock: vi.fn(),
    txSelectMock: vi.fn(),
    txInsertMock: vi.fn(),
    txDeleteMock: vi.fn(),
    dbInsertMock: vi.fn(),
    dbRegFindFirstMock: vi.fn(),
    dbSeasonFindFirstMock: vi.fn(),
    insertValuesCalls,
    validateCaptainVoteMock: vi.fn(),
    revalidateSeasonPathsMock: vi.fn(),
  };
});

// ── tx 对象（所有事务回调共用，成员 fn 都指向 hoisted refs）─────────────────
const TX = {
  query: {
    seasonRegistrations: { findFirst: txRegFindFirstMock },
    seasons: { findFirst: txSeasonFindFirstMock },
    captainVotes: { findFirst: txCaptainVoteFindFirstMock },
  },
  select: txSelectMock,
  insert: txInsertMock,
  delete: txDeleteMock,
};

// ── mocks ─────────────────────────────────────────────────────────────────────
vi.mock("@/lib/auth/session", () => ({
  requireAuth: requireAuthMock,
  requireSeasonAdmin: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/revalidation", () => ({
  revalidateSeasonPaths: revalidateSeasonPathsMock,
}));

vi.mock("@/lib/captains/rules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/captains/rules")>();
  return {
    ...actual,
    validateCaptainVote: validateCaptainVoteMock,
  };
});

vi.mock("@/db/client", () => ({
  db: {
    transaction: vi.fn((cb: (tx: typeof TX) => unknown) => cb(TX)),
    insert: dbInsertMock,
    query: {
      seasonRegistrations: { findFirst: dbRegFindFirstMock },
      seasons: { findFirst: dbSeasonFindFirstMock },
    },
  },
}));

// ── import after mocks ─────────────────────────────────────────────────────────
import { castVote, retractVote } from "@/actions/captains";

// ── 公共测试数据 ──────────────────────────────────────────────────────────────
const SESSION = mockUserSession({ userId: USER_ID_1, email: "player@example.com" });

const VOTER_REG = createFakeRegistration({
  id: VOTER_REG_ID,
  userId: USER_ID_1,
  seasonId: SEASON_ID,
  status: "approved",
  willingToBeCaptain: false,
});

const CANDIDATE_REG = createFakeRegistration({
  id: CANDIDATE_REG_ID,
  userId: USER_ID_2,
  seasonId: SEASON_ID,
  status: "approved",
  willingToBeCaptain: true,
});

const SEASON = createFakeSeason({
  id: SEASON_ID,
  slug: "spring-2026",
  status: "voting",
  hasCaptainVoting: true,
});

const CAST_INPUT = {
  voterRegistrationId: VOTER_REG_ID,
  candidateRegistrationId: CANDIDATE_REG_ID,
};

// ── 工具：mock tx.query.seasonRegistrations.findFirst 连续两次（voter/candidate）
function mockTxVoterCandidate(
  voter: typeof VOTER_REG | null,
  candidate: typeof CANDIDATE_REG | null,
) {
  txRegFindFirstMock
    .mockResolvedValueOnce(voter)
    .mockResolvedValueOnce(candidate);
}

// ── 工具：mock tx.select count ───────────────────────────────────────────────
function mockTxSelectCount(n: number) {
  txSelectMock.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ count: n }]),
    }),
  });
}

// ── 工具：mock tx.insert(captainVotes).values.returning ─────────────────────
function mockTxInsertVoteReturning(id: string) {
  txInsertMock.mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id }]),
    }),
  });
}

// ── 工具：mock db.insert(auditLogs).values(...)，并记录调用值 ────────────────
function mockDbInsertAudit() {
  dbInsertMock.mockReturnValue({
    values: vi.fn((vals: unknown) => {
      insertValuesCalls.push(vals);
      return Promise.resolve();
    }),
  });
}

// ── 工具：mock revalidateCaptainPaths 内部的两次 db.query ────────────────────
function mockRevalidatePaths() {
  dbRegFindFirstMock.mockResolvedValue({ seasonId: SEASON_ID });
  dbSeasonFindFirstMock.mockResolvedValue({ slug: SEASON.slug });
}

// ─────────────────────────────────────────────────────────────────────────────
describe("castVote()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuditTracking(insertValuesCalls);
    requireAuthMock.mockResolvedValue(SESSION);
    validateCaptainVoteMock.mockReturnValue(null); // 默认：无错误
  });

  it("参数校验失败（非 UUID）返回 VALIDATION_FAILED", async () => {
    const result = await castVote({
      voterRegistrationId: "not-a-uuid",
      candidateRegistrationId: "also-not-a-uuid",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it("投票者报名记录不存在返回 NOT_FOUND", async () => {
    mockTxVoterCandidate(null, null);

    const result = await castVote(CAST_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.NOT_FOUND);
    }
  });

  it("投票者不是当前用户（userId 不匹配）返回 FORBIDDEN", async () => {
    // voter.userId 与 session.userId 不同
    mockTxVoterCandidate(
      { ...VOTER_REG, userId: "99999999-9999-9999-9999-999999999999" },
      CANDIDATE_REG,
    );
    txSeasonFindFirstMock.mockResolvedValue(SEASON);
    mockTxSelectCount(0);
    txCaptainVoteFindFirstMock.mockResolvedValue(null);

    const result = await castVote(CAST_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.FORBIDDEN);
    }
  });

  it("正常投票成功，写入 audit_log，action 为 captain.cast_vote", async () => {
    mockTxVoterCandidate(VOTER_REG, CANDIDATE_REG);
    txSeasonFindFirstMock.mockResolvedValue(SEASON);
    mockTxSelectCount(1);
    txCaptainVoteFindFirstMock.mockResolvedValue(null);
    mockTxInsertVoteReturning(VOTE_ID);
    mockDbInsertAudit();
    mockRevalidatePaths();

    const result = await castVote(CAST_INPUT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.voteId).toBe(VOTE_ID);
    }

    expectAuditLog(insertValuesCalls, "captain.cast_vote", {
      actorId: USER_ID_1,
      targetId: CANDIDATE_REG_ID,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("retractVote()", () => {
  const RETRACT_INPUT = {
    voterRegistrationId: VOTER_REG_ID,
    candidateRegistrationId: CANDIDATE_REG_ID,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetAuditTracking(insertValuesCalls);
    requireAuthMock.mockResolvedValue(SESSION);
  });

  it("参数校验失败（非 UUID）返回 VALIDATION_FAILED", async () => {
    const result = await retractVote({
      voterRegistrationId: "bad",
      candidateRegistrationId: "bad",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it("投票者报名记录不存在返回 NOT_FOUND", async () => {
    // retractVote 事务内依次查 voter 和 candidate
    txRegFindFirstMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const result = await retractVote(RETRACT_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.NOT_FOUND);
    }
  });

  it("正常撤回投票成功，写入 audit_log，action 为 captain.retract_vote", async () => {
    txRegFindFirstMock
      .mockResolvedValueOnce(VOTER_REG)
      .mockResolvedValueOnce(CANDIDATE_REG);
    txSeasonFindFirstMock.mockResolvedValue(SEASON);
    txDeleteMock.mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDbInsertAudit();
    mockRevalidatePaths();

    const result = await retractVote(RETRACT_INPUT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.removed).toBe(true);
    }

    expectAuditLog(insertValuesCalls, "captain.retract_vote", {
      actorId: USER_ID_1,
      targetId: CANDIDATE_REG_ID,
    });
  });
});

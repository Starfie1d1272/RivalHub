import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  matchFindManyMock,
  proposalFindManyMock,
  txMatchFindFirstMock,
  txProposalFindFirstMock,
  txSeasonFindFirstMock,
  transactionMock,
  updateMock,
  insertMock,
  updateSetCalls,
  insertValuesCalls,
  revalidateMatchPathsMock,
} = vi.hoisted(() => {
  const updateSetCalls: unknown[] = [];
  const insertValuesCalls: unknown[] = [];
  return {
    matchFindManyMock: vi.fn(),
    proposalFindManyMock: vi.fn(),
    txMatchFindFirstMock: vi.fn(),
    txProposalFindFirstMock: vi.fn(),
    txSeasonFindFirstMock: vi.fn(),
    transactionMock: vi.fn(),
    updateMock: vi.fn(),
    insertMock: vi.fn(),
    updateSetCalls,
    insertValuesCalls,
    revalidateMatchPathsMock: vi.fn(),
  };
});

vi.mock("@/db/client", () => {
  const tx = {
    query: {
      matchTimeProposals: { findFirst: txProposalFindFirstMock },
      seasons: { findFirst: txSeasonFindFirstMock },
    },
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      for: txMatchFindFirstMock,
    }),
    update: updateMock,
    insert: insertMock,
  };

  return {
    db: {
      query: {
        matches: { findMany: matchFindManyMock },
        matchTimeProposals: { findMany: proposalFindManyMock },
      },
      transaction: transactionMock.mockImplementation((callback) => callback(tx)),
    },
  };
});

vi.mock("@/db/schema", () => ({
  matches: {
    id: "matches.id",
    status: "matches.status",
    scheduledAt: "matches.scheduledAt",
    completionDeadline: "matches.completionDeadline",
  },
  matchTimeProposals: {
    id: "match_time_proposals.id",
    matchId: "match_time_proposals.matchId",
    status: "match_time_proposals.status",
    createdAt: "match_time_proposals.createdAt",
  },
  auditLogs: {},
  seasons: { id: "seasons.id" },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
  asc: vi.fn((column: unknown) => ({ op: "asc", column })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  isNotNull: vi.fn((column: unknown) => ({ op: "isNotNull", column })),
  isNull: vi.fn((column: unknown) => ({ op: "isNull", column })),
  lte: vi.fn((left: unknown, right: unknown) => ({ op: "lte", left, right })),
  sql: vi.fn((strings: TemplateStringsArray) => strings.join("")),
}));

vi.mock("@/lib/revalidation", () => ({
  revalidateMatchPaths: revalidateMatchPathsMock,
}));

import { runMatchTimeAutoAwardCron } from "@/actions/matches/scheduling";

describe("runMatchTimeAutoAwardCron", () => {
  const now = new Date("2026-05-14T12:00:00.000Z");
  const proposedTime = new Date("2026-05-15T08:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    updateSetCalls.length = 0;
    insertValuesCalls.length = 0;
    // 默认没有超时提议，不影响现有测试断言
    proposalFindManyMock.mockResolvedValue([]);
    updateMock.mockImplementation(() => ({
      set: vi.fn((values) => {
        updateSetCalls.push(values);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    }));
    insertMock.mockImplementation(() => ({
      values: vi.fn((values) => {
        insertValuesCalls.push(values);
        return Promise.resolve();
      }),
    }));
  });

  it("awards the earliest pending proposal after the negotiation cutoff", async () => {
    matchFindManyMock.mockResolvedValue([{ id: "match-1" }]);
    txMatchFindFirstMock.mockResolvedValue([{
      id: "match-1",
      seasonId: "season-1",
      status: "scheduled",
      scheduledAt: null,
      completionDeadline: new Date("2026-05-15T12:00:00.000Z"),
    }]);
    txProposalFindFirstMock.mockResolvedValue({
      id: "proposal-1",
      proposedBy: "user-1",
      proposedTime,
    });
    txSeasonFindFirstMock.mockResolvedValue({ slug: "spring" });

    const result = await runMatchTimeAutoAwardCron(now);

    expect(result).toEqual({ processed: 1, awarded: 1, skipped: 0, failed: 0 });
    expect(updateSetCalls).toContainEqual({ scheduledAt: proposedTime, updatedAt: now });
    expect(updateSetCalls).toContainEqual({ status: "expired", updatedAt: now });
    expect(updateSetCalls).toContainEqual({
      status: "accepted",
      responseAt: now,
      updatedAt: now,
    });
    expect(insertValuesCalls).toContainEqual({
      seasonId: "season-1",
      action: "match.auto_award_time",
      actorId: "system",
      targetId: "match-1",
      targetType: "match",
      meta: {
        proposalId: "proposal-1",
        proposedBy: "user-1",
        scheduledAt: proposedTime.toISOString(),
      },
    });
    expect(revalidateMatchPathsMock).toHaveBeenCalledWith("spring", "match-1", { mode: "route" });
  });

  it("skips matches without pending proposals", async () => {
    matchFindManyMock.mockResolvedValue([{ id: "match-1" }]);
    txMatchFindFirstMock.mockResolvedValue([{
      id: "match-1",
      seasonId: "season-1",
      status: "scheduled",
      scheduledAt: null,
      completionDeadline: new Date("2026-05-15T12:00:00.000Z"),
    }]);
    txProposalFindFirstMock.mockResolvedValue(null);

    const result = await runMatchTimeAutoAwardCron(now);

    expect(result).toEqual({ processed: 1, awarded: 0, skipped: 1, failed: 0 });
    expect(updateSetCalls).toEqual([]);
    expect(insertValuesCalls).toEqual([]);
    expect(revalidateMatchPathsMock).not.toHaveBeenCalled();
  });
});

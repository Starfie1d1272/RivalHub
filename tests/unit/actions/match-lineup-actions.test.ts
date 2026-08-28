import { describe, expect, it, vi, beforeEach } from "vitest";
import { ErrorCode } from "@/lib/errors";

/**
 * Thin-wrapper contract tests for the G1/G2 lineup & correction actions.
 * The transactional bodies live in lib/*-service modules (covered by the
 * real-PostgreSQL local suites); here we pin the wrapper behaviour: actor
 * resolution, service invocation shape, idempotent results and fail-closed
 * error mapping.
 */

const stubs = vi.hoisted(() => {
  const txStub = {
    insert: () => ({ values: async () => undefined }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
  return {
    txStub,
    lockMatchInTx: vi.fn(),
    assertStartingLineupAllowedInTx: vi.fn(),
    persistMatchRosterInTx: vi.fn(),
    confirmMatchRosterInTx: vi.fn(),
    planResultCorrectionInTx: vi.fn(),
    applyResultCorrectionInTx: vi.fn(),
    recordRecoveryAdjudicationInTx: vi.fn(),
  };
});

let rosterRow: unknown = null;

vi.mock("@/db/client", () => ({
  db: {
    query: {
      matchRosters: { findFirst: async () => rosterRow },
      seasons: { findFirst: async () => ({ slug: "test-season" }) },
    },
    select: () => ({
      from: () => ({
        where: async () => (rosterRow ? [rosterRow] : []),
      }),
    }),
    transaction: async <T>(body: (tx: unknown) => Promise<T>): Promise<T> =>
      body(stubs.txStub),
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuth: vi.fn(async () => ({ userId: "user-1", email: "captain@local.test" })),
  requireSeasonAdmin: vi.fn(async () => ({ userId: "admin-1", email: "admin@local.test" })),
  auditActorId: vi.fn((session: { email?: string }) => session.email ?? "actor"),
}));

vi.mock("@/lib/action-utils", () => ({
  getMatchOrThrow: vi.fn(),
  actionError: vi.fn(
    (_scope: string, e: unknown): { success: false; error: { code: string; message: string } } => ({
      success: false,
      error: {
        code:
          typeof e === "object" && e !== null && "code" in e
            ? String((e as { code: unknown }).code)
            : ErrorCode.INTERNAL_ERROR,
        message: e instanceof Error ? e.message : String(e),
      },
    }),
  ),
}));

vi.mock("@/lib/revalidation", () => ({
  revalidateMatchPaths: vi.fn(),
  revalidateSeasonPaths: vi.fn(),
}));

vi.mock("@/actions/matches/_shared", () => ({
  // The acting user captains team A of the stubbed match.
  getTeamIdForCaptain: vi.fn(async (_userId: string, match: { teamAId: string; teamBId: string }) =>
    match.teamAId,
  ),
}));

vi.mock("@/lib/match-rosters/service", () => stubs);
vi.mock("@/lib/match-corrections/service", () => stubs);

import {
  adminSelectMatchRoster,
  confirmMatchRoster,
  submitMatchRoster,
  unlockMatchRoster,
} from "@/actions/matches/roster";
import {
  applyMatchResultCorrection,
  planMatchResultCorrection,
  recordMatchRecoveryAdjudication,
} from "@/actions/matches/corrections";
import { AppError } from "@/lib/errors";
import { getMatchOrThrow } from "@/lib/action-utils";

const mockedGetMatch = vi.mocked(getMatchOrThrow);
const SCHEDULED_MATCH = {
  id: "match-1",
  seasonId: "season-1",
  status: "scheduled" as const,
  teamAId: "team-a",
  teamBId: "team-b",
};

function fullLockedMatch() {
  return {
    id: "match-1",
    seasonId: "season-1",
    status: "scheduled" as const,
    teamAId: "team-a",
    teamBId: "team-b",
  };
}

const serviceMocks = [
  stubs.lockMatchInTx,
  stubs.assertStartingLineupAllowedInTx,
  stubs.persistMatchRosterInTx,
  stubs.confirmMatchRosterInTx,
  stubs.planResultCorrectionInTx,
  stubs.applyResultCorrectionInTx,
  stubs.recordRecoveryAdjudicationInTx,
];

beforeEach(() => {
  for (const mock of serviceMocks) {
    mock.mockReset();
  }
  rosterRow = null;
});

describe("match lineup actions", () => {
  it("submits a participant lineup through the transactional service", async () => {
    mockedGetMatch.mockResolvedValue(SCHEDULED_MATCH as never);
    stubs.lockMatchInTx.mockResolvedValue(fullLockedMatch());
    stubs.assertStartingLineupAllowedInTx.mockResolvedValue({ affiliatedStarterCounts: new Map() });
    stubs.persistMatchRosterInTx.mockResolvedValue({
      rosterId: "roster-1",
      matchId: "match-1",
      teamId: "team-a",
      starterIds: ["m1"],
      substituteIds: [],
    });

    const result = await submitMatchRoster("match-1", { starterIds: ["m1", "m2", "m3", "m4", "m5"] });

    expect(result.success).toBe(true);
    const [, payload] = stubs.persistMatchRosterInTx.mock.calls[0]!;
    expect(payload).toMatchObject({ source: "participant", submittedBy: "user-1", teamId: "team-a" });
  });

  it("maps eligibility failures to failure results without throwing", async () => {
    mockedGetMatch.mockResolvedValue(SCHEDULED_MATCH as never);
    stubs.lockMatchInTx.mockResolvedValue(fullLockedMatch());
    stubs.assertStartingLineupAllowedInTx.mockRejectedValue(
      new AppError(ErrorCode.VALIDATION_FAILED, "首发不足"),
    );
    const result = await submitMatchRoster("match-1", { starterIds: ["m1"] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it("rejects submissions once the match is not scheduled anymore", async () => {
    mockedGetMatch.mockResolvedValue({ ...SCHEDULED_MATCH, status: "in_progress" } as never);
    const result = await submitMatchRoster("match-1", { starterIds: ["m1"] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(stubs.persistMatchRosterInTx).not.toHaveBeenCalled();
  });

  it("records admin selections explicitly sourced as admin_select", async () => {
    mockedGetMatch.mockResolvedValue(SCHEDULED_MATCH as never);
    stubs.lockMatchInTx.mockResolvedValue(fullLockedMatch());
    stubs.assertStartingLineupAllowedInTx.mockResolvedValue({ affiliatedStarterCounts: new Map() });
    stubs.persistMatchRosterInTx.mockImplementation(async (_tx, args) => ({
      rosterId: "roster-2",
      matchId: args.match.id,
      teamId: args.teamId,
      starterIds: [...args.starterIds],
      substituteIds: [],
    }));

    const result = await adminSelectMatchRoster("match-1", "team-b", { starterIds: ["b1", "b2", "b3", "b4", "b5"] });

    expect(result.success).toBe(true);
    const [, payload] = stubs.persistMatchRosterInTx.mock.calls[0]!;
    expect(payload.source).toBe("admin_select");
    expect(payload.submittedBy).toBeNull();
    expect(payload.teamId).toBe("team-b");
  });

  it("propagates idempotent confirm outcomes untouched", async () => {
    rosterRow = { matchId: "match-1" };
    mockedGetMatch.mockResolvedValue({ ...SCHEDULED_MATCH, status: "scheduled" } as never);
    stubs.confirmMatchRosterInTx.mockResolvedValue({
      rosterId: "roster-3",
      matchId: "match-1",
      teamId: "team-b",
      starterIds: ["b1", "b2", "b3", "b4", "b5"],
      alreadyConfirmed: true,
    });

    const result = await confirmMatchRoster("roster-3");

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.alreadyConfirmed).toBe(true);
  });

  it("fails closed when unlocking would touch a started match", async () => {
    rosterRow = { id: "roster-locked", matchId: "match-1", teamId: "team-a", status: "confirmed" };
    mockedGetMatch.mockResolvedValue(SCHEDULED_MATCH as never);
    stubs.lockMatchInTx.mockResolvedValue({ ...fullLockedMatch(), status: "in_progress" });

    const result = await unlockMatchRoster("roster-locked");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCode.MATCH_INVALID_TRANSITION);
  });
});

describe("correction workflow actions", () => {
  const FINISHED_MATCH = { id: "match-1", seasonId: "season-1", status: "finished" as const };

  it("plans corrections read-only and forwards proposals", async () => {
    mockedGetMatch.mockResolvedValue(FINISHED_MATCH as never);
    stubs.planResultCorrectionInTx.mockResolvedValue({ winnerChanges: true, impacts: [] });

    const result = await planMatchResultCorrection("match-1", { scoreA: 13, scoreB: 4 });

    expect(result.success).toBe(true);
    const [txArg, args] = stubs.planResultCorrectionInTx.mock.calls[0]!;
    expect(txArg).toBe(stubs.txStub);
    expect(args.proposal).toEqual({ scoreA: 13, scoreB: 4 });
  });

  it("forwards confirmRecovery as an explicit boolean flag", async () => {
    mockedGetMatch.mockResolvedValue(FINISHED_MATCH as never);
    stubs.applyResultCorrectionInTx.mockResolvedValue({
      alreadyApplied: false,
      winnerChanged: true,
      invalidatedDownstreamMatches: ["downstream-1"],
      rolledBackToFinalized: 0,
    });

    const result = await applyMatchResultCorrection("match-1", {
      scoreA: 13,
      scoreB: 4,
      confirmRecovery: true,
    });

    expect(result.success).toBe(true);
    expect(stubs.applyResultCorrectionInTx.mock.calls[0]![1]).toMatchObject({
      proposal: { scoreA: 13, scoreB: 4 },
      actorId: "admin@local.test",
      confirmRecovery: true,
    });
    if (result.success) expect(result.data.invalidatedCount).toBe(1);
  });

  it("records adjudications with the acting administrator", async () => {
    mockedGetMatch.mockResolvedValue(FINISHED_MATCH as never);
    stubs.recordRecoveryAdjudicationInTx.mockResolvedValue({ recorded: true });

    const result = await recordMatchRecoveryAdjudication("match-1", "人工恢复说明");

    expect(result.success).toBe(true);
    expect(stubs.recordRecoveryAdjudicationInTx).toHaveBeenCalledWith(stubs.txStub, {
      matchId: "match-1",
      actorId: "admin@local.test",
      note: "人工恢复说明",
    });
  });
});

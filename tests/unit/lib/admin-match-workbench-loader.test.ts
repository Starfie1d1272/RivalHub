import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  seasonFindFirstMock,
  matchFindFirstMock,
  entryFindManyMock,
  mapFindManyMock,
  vetoSessionFindFirstMock,
  postMatchFindFirstMock,
  requireSeasonAdminMock,
  selectMock,
  preflightMock,
  transactionMock,
} = vi.hoisted(() => ({
  seasonFindFirstMock: vi.fn(),
  matchFindFirstMock: vi.fn(),
  entryFindManyMock: vi.fn(),
  mapFindManyMock: vi.fn(),
  vetoSessionFindFirstMock: vi.fn(),
  postMatchFindFirstMock: vi.fn(),
  requireSeasonAdminMock: vi.fn(),
  selectMock: vi.fn(),
  preflightMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    query: {
      seasons: { findFirst: seasonFindFirstMock },
      matches: { findFirst: matchFindFirstMock },
      competitionEntries: { findMany: entryFindManyMock },
      matchMaps: { findMany: mapFindManyMock },
      matchVetoSessions: { findFirst: vetoSessionFindFirstMock },
      postMatchReports: { findFirst: postMatchFindFirstMock },
      matchLiveSessions: { findFirst: vi.fn().mockResolvedValue(undefined) },
      competitionQualificationRuns: { findFirst: vi.fn().mockResolvedValue(undefined) },
    },
    select: selectMock,
    transaction: transactionMock,
  },
}));
vi.mock("@/lib/match-rosters/service", () => ({ getStartingLineupPreflightInTx: preflightMock }));
vi.mock("@/lib/auth/session", () => ({ requireSeasonAdmin: requireSeasonAdminMock }));

import { matchRosters } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { loadAdminMatchWorkbench } from "@/lib/admin/matches/workbench";

function selectBuilder<T>(result: T) {
  const builder = {
    from: vi.fn(() => builder),
    innerJoin: vi.fn(() => builder),
    leftJoin: vi.fn(() => builder),
    where: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    then: (resolve: (value: T) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

const season = {
  id: "season-1",
  slug: "major",
  name: "Major",
  stagePlan: [],
  registrationConfig: { mapPool: ["de_inferno"] },
};

const match = {
  id: "match-1",
  seasonId: "season-1",
  entryAId: "entry-a",
  entryBId: "entry-b",
  stage: "qualifier",
  round: null,
  format: "bo1",
  entryRound: null,
  scoreA: null,
  scoreB: null,
  status: "scheduled",
  isForfeit: false,
  bracketNodeId: null,
  ownership: "manual",
  majorStageRunId: null,
  managedKey: null,
  scheduledAt: null,
  completionDeadline: null,
  completedAt: null,
  videoUrl: null,
  mvpWinnerUserId: null,
  createdAt: new Date("2026-09-05T00:00:00Z"),
  updatedAt: new Date("2026-09-05T00:00:00Z"),
};

describe("loadAdminMatchWorkbench", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seasonFindFirstMock.mockResolvedValue(season);
    matchFindFirstMock.mockResolvedValue(match);
    entryFindManyMock.mockResolvedValue([
      { id: "entry-a", name: "Alpha" },
      { id: "entry-b", name: "Beta" },
    ]);
    mapFindManyMock.mockResolvedValue([]);
    vetoSessionFindFirstMock.mockResolvedValue(undefined);
    postMatchFindFirstMock.mockResolvedValue(undefined);
    requireSeasonAdminMock.mockResolvedValue({ userId: "admin-1" });
    selectMock.mockImplementation(() => selectBuilder([]));
  });

  it("shows qualification snapshot validation as a preparation blocker for manual Play-in", async () => {
    matchFindFirstMock.mockResolvedValue({ ...match, stage: "play-in", qualificationRunId: "run-1" });
    const rosterRows = [
      { id: "roster-a", entryId: "entry-a", status: "submitted", source: "participant", submittedAt: null, confirmedAt: null },
      { id: "roster-b", entryId: "entry-b", status: "submitted", source: "participant", submittedAt: null, confirmedAt: null },
    ];
    selectMock.mockImplementation(() => {
      let rows: unknown[] = [];
      const builder = { from: (table: unknown) => { rows = table === matchRosters ? rosterRows : []; return builder; },
        innerJoin: () => builder, leftJoin: () => builder, where: () => builder, orderBy: () => builder, limit: () => builder,
        then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
      return builder;
    });
    transactionMock.mockImplementation((run: (tx: unknown) => unknown) => run({}));
    preflightMock.mockRejectedValue(new AppError(ErrorCode.VALIDATION_FAILED, "Play-in 资格快照缺失或名单版本已变化，请先同步已批准名单。"));
    const result = await loadAdminMatchWorkbench({ seasonSlug: "major", matchId: "match-1" });
    expect(preflightMock).toHaveBeenCalledTimes(2);
    expect(result?.teamAPreflight).toMatchObject({ valid: false, blockers: [expect.stringContaining("请先同步")] });
    expect(result?.teamBPreflight).toMatchObject({ valid: false });
  });

  it("authorizes a valid scoped match before loading detail facts", async () => {
    const result = await loadAdminMatchWorkbench({ seasonSlug: "major", matchId: "match-1" });

    expect(requireSeasonAdminMock).toHaveBeenCalledWith("season-1");
    expect(result).toMatchObject({
      season: { id: "season-1", slug: "major" },
      match: { id: "match-1", seasonId: "season-1" },
      teamAName: "Alpha",
      teamBName: "Beta",
      vetoCompletedAt: null,
    });
  });

  it("returns null before authorization or detail queries for a cross-season match id", async () => {
    matchFindFirstMock.mockResolvedValue(undefined);

    const result = await loadAdminMatchWorkbench({ seasonSlug: "major", matchId: "match-from-other-season" });

    expect(result).toBeNull();
    expect(requireSeasonAdminMock).not.toHaveBeenCalled();
    expect(entryFindManyMock).not.toHaveBeenCalled();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("returns null for an unknown season before looking up a match", async () => {
    seasonFindFirstMock.mockResolvedValue(undefined);

    const result = await loadAdminMatchWorkbench({ seasonSlug: "missing-season", matchId: "match-1" });

    expect(result).toBeNull();
    expect(matchFindFirstMock).not.toHaveBeenCalled();
    expect(requireSeasonAdminMock).not.toHaveBeenCalled();
  });

  it("does not render detail data when the season admin guard rejects", async () => {
    requireSeasonAdminMock.mockRejectedValue(new Error("FORBIDDEN"));

    await expect(loadAdminMatchWorkbench({ seasonSlug: "major", matchId: "match-1" })).rejects.toThrow("FORBIDDEN");
    expect(entryFindManyMock).not.toHaveBeenCalled();
    expect(selectMock).not.toHaveBeenCalled();
  });
});

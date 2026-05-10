import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock db before importing executor — use vi.hoisted so variables are
// available in the hoisted vi.mock factory.
const {
  mockInsert,
  mockSwissFindMany,
  mockMatchFindMany,
  mockTeamFindMany,
  mockTransaction,
  mockTxMatchFindMany,
  mockTxSwissFindMany,
} = vi.hoisted(() => {
  const mockTxMatchFindMany = vi.fn();
  const mockTxSwissFindMany = vi.fn();
  const mockTxUpdate = vi.fn().mockImplementation(() => ({
    set: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
  }));
  const mockTxInsert = vi.fn().mockImplementation(() => ({
    values: vi.fn().mockResolvedValue(undefined),
  }));
  const tx = {
    query: {
      matches: { findMany: mockTxMatchFindMany },
      swissStandings: { findMany: mockTxSwissFindMany },
    },
    update: mockTxUpdate,
    insert: mockTxInsert,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockTransaction = vi.fn().mockImplementation(async (fn: (tx: any) => unknown) => fn(tx));

  return {
    mockInsert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    mockSwissFindMany: vi.fn(),
    mockMatchFindMany: vi.fn(),
    mockTeamFindMany: vi.fn(),
    mockTransaction,
    mockTxMatchFindMany,
    mockTxSwissFindMany,
  };
});

vi.mock("@/db/client", () => ({
  db: {
    insert: mockInsert,
    transaction: mockTransaction,
    query: {
      swissStandings: { findMany: mockSwissFindMany },
      matches: { findMany: mockMatchFindMany },
      teams: { findMany: mockTeamFindMany },
    },
  },
}));

import { swissExecutor } from "@/lib/formats/swiss";
import { AppError } from "@/lib/errors";
import type { Team } from "@/db/schema/teams";

function makeTeams(n: number): Team[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `team-${i}`,
    name: `Team ${i + 1}`,
    seasonId: "season-1",
    draftOrder: i + 1,
  } as Team));
}

function makeStanding(teamId: string, wins = 0, losses = 0) {
  return {
    id: `standing-${teamId}`,
    seasonId: "season-1",
    stage: "swiss-stage",
    teamId,
    seed: 1,
    wins,
    losses,
    buScore: 0,
    status: "active" as const,
  };
}

const mockConfig = {
  key: "swiss-stage",
  name: "瑞士轮",
  type: "swiss" as const,
  teamCount: 8,
  advanceTiers: [{ placement: "*" as const, count: 8 }],
  seeds: [1, 2, 3, 4, 5, 6, 7, 8],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
});

describe("swissExecutor", () => {
  // Case 1: initialize
  describe("initialize()", () => {
    it("inserts standings and creates R1 matches (top-half vs bottom-half)", async () => {
      const result = await swissExecutor.initialize(
        "season-1",
        mockConfig,
        makeTeams(8),
        undefined,
      );

      // 1 batch standings insert + 1 batch match insert = 2 insert calls
      expect(mockInsert).toHaveBeenCalledTimes(2);
      expect(result.matchCount).toBe(4);
    });

    it("throws when seeds length !== teams length", async () => {
      await expect(
        swissExecutor.initialize(
          "season-1",
          { ...mockConfig, seeds: [1, 2] },
          makeTeams(8),
          undefined,
        ),
      ).rejects.toThrow(AppError);
    });
  });

  // Case 2: advanceRound
  describe("advanceRound()", () => {
    it("throws DRAFT_NOT_ACTIVE when no matches exist", async () => {
      mockTxMatchFindMany.mockResolvedValue([]);
      await expect(
        swissExecutor.advanceRound!("season-1", "swiss-stage"),
      ).rejects.toThrow(AppError);
    });

    it("throws SEASON_INVALID_STATUS when unfinished matches exist", async () => {
      mockTxMatchFindMany.mockResolvedValue([
        { id: "m-1", round: 1, status: "scheduled", teamAId: "team-0", teamBId: "team-1", scoreA: null, scoreB: null },
      ]);
      await expect(
        swissExecutor.advanceRound!("season-1", "swiss-stage"),
      ).rejects.toThrow(AppError);
    });

    it("throws VALIDATION_FAILED when score is null on finished match", async () => {
      mockTxMatchFindMany.mockResolvedValue([
        { id: "m-1", round: 1, status: "finished", teamAId: "team-0", teamBId: "team-1", scoreA: null, scoreB: null },
      ]);
      mockTxSwissFindMany.mockResolvedValue([
        makeStanding("team-0"),
        makeStanding("team-1"),
      ]);
      await expect(
        swissExecutor.advanceRound!("season-1", "swiss-stage"),
      ).rejects.toThrow(AppError);
    });

    it("throws VALIDATION_FAILED on draw", async () => {
      mockTxMatchFindMany.mockResolvedValue([
        { id: "m-1", round: 1, status: "finished", teamAId: "team-0", teamBId: "team-1", scoreA: 1, scoreB: 1 },
      ]);
      mockTxSwissFindMany.mockResolvedValue([
        makeStanding("team-0"),
        makeStanding("team-1"),
      ]);
      await expect(
        swissExecutor.advanceRound!("season-1", "swiss-stage"),
      ).rejects.toThrow(AppError);
    });
  });

  // Case 3: isComplete
  describe("isComplete()", () => {
    it("returns true when all standings are advanced or eliminated", async () => {
      mockSwissFindMany.mockResolvedValue([
        { status: "advanced" },
        { status: "eliminated" },
      ]);

      const result = await swissExecutor.isComplete("season-1", "swiss-stage");
      expect(result).toBe(true);
    });

    it("returns false when any standing is active", async () => {
      mockSwissFindMany.mockResolvedValue([
        { status: "advanced" },
        { status: "active" },
      ]);

      const result = await swissExecutor.isComplete("season-1", "swiss-stage");
      expect(result).toBe(false);
    });

    it("returns false when no standings exist", async () => {
      mockSwissFindMany.mockResolvedValue([]);

      const result = await swissExecutor.isComplete("season-1", "swiss-stage");
      expect(result).toBe(false);
    });
  });

  // Case 4: getQualifiers
  describe("getQualifiers()", () => {
    it("returns advanced teams as QualifiedTeam[]", async () => {
      mockSwissFindMany.mockResolvedValue([
        { teamId: "t0", seed: 1, status: "advanced" },
        { teamId: "t3", seed: 4, status: "advanced" },
      ]);

      const result = await swissExecutor.getQualifiers("season-1", mockConfig);
      expect(result).toEqual([
        { teamId: "t0", placement: "*" },
        { teamId: "t3", placement: "*" },
      ]);
    });

    it("returns empty array when no team has advanced", async () => {
      mockSwissFindMany.mockResolvedValue([]);

      const result = await swissExecutor.getQualifiers("season-1", mockConfig);
      expect(result).toEqual([]);
    });
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock db before importing executor — use vi.hoisted so variables are
// available in the hoisted vi.mock factory.
const { mockInsert, mockSwissFindMany, mockMatchFindMany, mockTeamFindMany } = vi.hoisted(() => ({
  mockInsert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
  mockSwissFindMany: vi.fn(),
  mockMatchFindMany: vi.fn(),
  mockTeamFindMany: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    insert: mockInsert,
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

const mockConfig = {
  key: "swiss-stage",
  name: "瑞士轮",
  type: "swiss" as const,
  teamCount: 8,
  advance: 8,
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

  // Case 4: isComplete
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

  // Case 5: getQualifiers
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

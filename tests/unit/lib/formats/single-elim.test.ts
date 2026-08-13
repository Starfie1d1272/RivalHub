import { describe, expect, it, vi, beforeEach } from "vitest";

// ── mock bracket adapter ─────────────────────────────────────────────────────
const { mockGenerateBracket, mockSeedPlayoff } = vi.hoisted(() => ({
  mockGenerateBracket: vi.fn(),
  mockSeedPlayoff: vi.fn(),
}));

vi.mock("@/lib/bracket", () => ({
  generateBracket: mockGenerateBracket,
  seedPlayoff: mockSeedPlayoff,
}));

// ── mock db ───────────────────────────────────────────────────────────────────
const {
  mockInsert,
  mockUpdate,
  mockFindFirst,
  mockInsertValues,
  mockMatchFindMany,
} = vi.hoisted(() => {
  const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  const mockInsertValues = vi.fn().mockResolvedValue(undefined);
  const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });
  return {
    mockInsert,
    mockUpdate: vi.fn().mockReturnValue({ set: setMock }),
    mockFindFirst: vi.fn(),
    mockInsertValues,
    mockMatchFindMany: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@/db/client", () => ({
  db: {
    insert: mockInsert,
    update: mockUpdate,
    query: {
      seasons: { findFirst: mockFindFirst },
      matches: { findMany: mockMatchFindMany },
      teams: { findMany: vi.fn().mockResolvedValue([]) },
    },
  },
}));

// ── mock seasons schema ───────────────────────────────────────────────────────
vi.mock("@/db/schema", () => ({
  matches: {
    id: { defaultValue: "m-1" },
  },
  seasons: {
    id: {},
    bracketData: {},
    updatedAt: {},
    stagePlan: {},
  },
  teams: {
    id: {},
    name: {},
    seasonId: {},
  },
}));

import { singleElimExecutor } from "@/lib/formats/single-elim";
import { AppError } from "@/lib/errors";
import type { Team } from "@/db/schema/teams";
import type { QualifiedTeam } from "@/types/season";

function makeTeams(n: number): Team[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `team-${i}`,
    name: `战队 ${i + 1}`,
    seasonId: "season-1",
    draftOrder: i + 1,
  } as Team));
}

function makeQualifiers(): QualifiedTeam[] {
  return [
    { teamId: "team-0", placement: "1st", group: "A" },
    { teamId: "team-1", placement: "1st", group: "B" },
    { teamId: "team-2", placement: "2nd", group: "A" },
    { teamId: "team-3", placement: "2nd", group: "B" },
    { teamId: "team-4", placement: "3rd", group: "A" },
    { teamId: "team-5", placement: "3rd", group: "B" },
  ];
}

const mockConfig = {
  key: "playoff",
  name: "淘汰赛",
  type: "single_elim" as const,
  teamCount: 8,
  advanceTiers: [
    { placement: "1st", count: 1 },
  ],
};

const mockSeason = {
  id: "season-1",
  slug: "test",
  status: "playing",
  stagePlan: [
    { key: "qualifier", name: "排位赛", type: "round_robin" as const, teamCount: 8, advanceTiers: [{ placement: "*" as const, count: 8 }] },
    { key: "playoff", name: "淘汰赛", type: "single_elim" as const, teamCount: 8, advanceTiers: [{ placement: "1st", count: 1 }] },
  ],
  bracketData: {
    stage: [{ id: 2, name: "淘汰赛", type: "single_elimination" }],
    match: [],
    match_game: [],
    participant: [],
    round: [],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockInsert.mockReturnValue({ values: mockInsertValues });
  mockUpdate.mockReturnValue({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  });
});

describe("singleElimExecutor", () => {
  // ── initialize ────────────────────────────────────────────────────────────

  describe("initialize()", () => {
    it("generates standalone bracket when no previous stage", async () => {
      mockFindFirst.mockResolvedValue({
        ...mockSeason,
        // 只有当前阶段，无上一阶段 → !previousStage 分支
        stagePlan: [
          { key: "playoff", name: "淘汰赛", type: "single_elim" as const, teamCount: 8, advanceTiers: [{ placement: "1st" as const, count: 1 }] },
        ],
      });

      mockGenerateBracket.mockResolvedValue({
        data: {
          stage: [{ id: 1, name: "淘汰赛", type: "single_elimination" }],
          match: [],
          match_game: [],
          participant: makeTeams(8).map((t, i) => ({ id: i, name: t.name })),
          round: [{ id: 1, stage_id: 1, number: 1 }],
        },
        resolvedMatches: [
          { bracketMatchId: 1, stageId: 1, teamAParticipantId: 0, teamBParticipantId: 7, roundNumber: 1 },
          { bracketMatchId: 2, stageId: 1, teamAParticipantId: 1, teamBParticipantId: 6, roundNumber: 1 },
          { bracketMatchId: 3, stageId: 1, teamAParticipantId: 2, teamBParticipantId: 5, roundNumber: 1 },
          { bracketMatchId: 4, stageId: 1, teamAParticipantId: 3, teamBParticipantId: 4, roundNumber: 1 },
        ],
      });

      const result = await singleElimExecutor.initialize(
        "season-1",
        mockConfig,
        makeTeams(8),
        undefined,
      );

      expect(mockGenerateBracket).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ playoffFormat: "single_elim" }),
      );
      // 4 QF matches inserted + 1 season update = 5 write calls
      // insert called 4 times for matches
      expect(result.matchCount).toBe(4);
    });

    it("throws when no qualifiers provided for non-first stage", async () => {
      mockFindFirst.mockResolvedValue(mockSeason);

      await expect(
        singleElimExecutor.initialize("season-1", mockConfig, makeTeams(8), undefined),
      ).rejects.toThrow(AppError);
    });

    it("throws when season not found", async () => {
      mockFindFirst.mockResolvedValue(null);

      await expect(
        singleElimExecutor.initialize("season-1", mockConfig, makeTeams(8), undefined),
      ).rejects.toThrow(AppError);
    });

    it("uses seedPlayoff with qualifier-based seeding", async () => {
      mockFindFirst.mockResolvedValue(mockSeason);

      mockSeedPlayoff.mockResolvedValue({
        updatedData: {
          stage: [{ id: 2, name: "淘汰赛", type: "single_elimination" }],
          match: [],
          match_game: [],
          participant: [
            { id: 0, name: "战队 1" },
            { id: 1, name: "战队 2" },
            { id: 2, name: "战队 3" },
            { id: 3, name: "战队 4" },
            { id: 4, name: "战队 5" },
            { id: 5, name: "战队 6" },
          ],
          round: [{ id: 1, stage_id: 2, number: 1 }, { id: 2, stage_id: 2, number: 2 }],
        },
        resolvedMatches: [
          { bracketMatchId: 5, stageId: 2, teamAParticipantId: 0, teamBParticipantId: 3, roundNumber: 1 },
          { bracketMatchId: 6, stageId: 2, teamAParticipantId: 1, teamBParticipantId: 2, roundNumber: 1 },
        ],
      });

      const result = await singleElimExecutor.initialize(
        "season-1",
        mockConfig,
        makeTeams(8),
        makeQualifiers(),
      );

      // 1st 在末尾 → buildSeedingFromQualifiers 输出：
      // [2nd-A, 2nd-B, 3rd-A, 3rd-B, 1st-A, 1st-B]
      expect(mockSeedPlayoff).toHaveBeenCalledWith(
        ["战队 3", "战队 4", "战队 5", "战队 6", "战队 1", "战队 2"],
        expect.anything(),
        "淘汰赛",
      );
      expect(result.matchCount).toBe(2);
    });

    it("sets entry_round on created matches", async () => {
      mockFindFirst.mockResolvedValue({
        ...mockSeason,
        // 只有当前阶段，无上一阶段
        stagePlan: [
          { key: "playoff", name: "淘汰赛", type: "single_elim" as const, teamCount: 8, advanceTiers: [{ placement: "1st" as const, count: 1 }] },
        ],
      });

      mockGenerateBracket.mockResolvedValue({
        data: {
          stage: [{ id: 1, name: "淘汰赛", type: "single_elimination" }],
          match: [],
          match_game: [],
          participant: makeTeams(8).map((t, i) => ({ id: i, name: t.name })),
          round: [
            { id: 1, stage_id: 1, number: 1 },
            { id: 2, stage_id: 1, number: 2 },
            { id: 3, stage_id: 1, number: 3 },
          ],
        },
        resolvedMatches: [
          { bracketMatchId: 1, stageId: 1, teamAParticipantId: 0, teamBParticipantId: 1, roundNumber: 1 },
          { bracketMatchId: 2, stageId: 1, teamAParticipantId: 2, teamBParticipantId: 3, roundNumber: 2 },
        ],
      });

      await singleElimExecutor.initialize(
        "season-1",
        { ...mockConfig, teamCount: 8 },
        makeTeams(8),
        undefined,
      );

      // 验证 insert values 被调用时包含 entry_round
      const qfCall = mockInsertValues.mock.calls.find(
        ([value]) => (value as { entryRound?: string })?.entryRound === "quarterfinal",
      );
      expect(qfCall).toBeTruthy();
    });
  });

  // ── getQualifiers ──────────────────────────────────────────────────────────

  describe("getQualifiers()", () => {
    const finishedMatch = (
      teamAId: string,
      teamBId: string,
      scoreA: number,
      scoreB: number,
      entryRound: string | null = null,
    ) => ({
      id: `m-${teamAId}-${teamBId}`,
      seasonId: "season-1",
      stage: "playoff",
      teamAId,
      teamBId,
      scoreA,
      scoreB,
      status: "finished" as const,
      entryRound,
      round: null,
      format: "bo3" as const,
      bracketNodeId: null,
      scheduledAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    beforeEach(() => {
      mockMatchFindMany.mockResolvedValue([]);
    });

    it("returns empty array when no finished matches", async () => {
      mockMatchFindMany.mockResolvedValue([]);
      const result = await singleElimExecutor.getQualifiers("season-1", mockConfig);
      expect(result).toEqual([]);
    });

    it("returns empty array when no match has entryRound=final", async () => {
      mockMatchFindMany.mockResolvedValue([
        finishedMatch("t1", "t2", 2, 0, "quarterfinal"),
        finishedMatch("t3", "t4", 2, 1, "semifinal"),
      ]);
      const result = await singleElimExecutor.getQualifiers("season-1", mockConfig);
      expect(result).toEqual([]);
    });

    it("returns only 1st place when advanceTiers has no 2nd", async () => {
      mockMatchFindMany.mockResolvedValue([
        finishedMatch("t1", "t2", 2, 0, "quarterfinal"),
        finishedMatch("winner", "loser", 2, 1, "final"),
      ]);
      const result = await singleElimExecutor.getQualifiers("season-1", mockConfig);
      expect(result).toEqual([{ teamId: "winner", placement: "1st" }]);
    });

    it("returns 1st and 2nd when advanceTiers includes 2nd", async () => {
      mockMatchFindMany.mockResolvedValue([
        finishedMatch("winner", "loser", 2, 0, "final"),
      ]);
      const configWith2nd = {
        ...mockConfig,
        advanceTiers: [
          { placement: "1st", count: 1 },
          { placement: "2nd", count: 1 },
        ],
      };
      const result = await singleElimExecutor.getQualifiers("season-1", configWith2nd);
      expect(result).toEqual([
        { teamId: "winner", placement: "1st" },
        { teamId: "loser", placement: "2nd" },
      ]);
    });
  });
});

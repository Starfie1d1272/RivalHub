import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateStageBracket, mockEnsureResolvedBracketMatch, mockSaveStageBracketState, mockInsert, mockInsertValues, mockMatchFindMany } = vi.hoisted(() => ({
  mockCreateStageBracket: vi.fn(),
  mockEnsureResolvedBracketMatch: vi.fn(),
  mockSaveStageBracketState: vi.fn(),
  mockInsert: vi.fn(),
  mockInsertValues: vi.fn(),
  mockMatchFindMany: vi.fn(),
}));

vi.mock("@/lib/bracket", () => ({
  createStageBracket: mockCreateStageBracket,
  ensureResolvedBracketMatch: mockEnsureResolvedBracketMatch,
  saveStageBracketState: mockSaveStageBracketState,
}));

vi.mock("@/db/client", () => ({
  db: {
    insert: mockInsert,
    query: { matches: { findMany: mockMatchFindMany } },
  },
}));

vi.mock("@/db/schema", () => ({ matches: {} }));
vi.mock("drizzle-orm", () => ({ and: vi.fn(), eq: vi.fn() }));

import { singleElimExecutor } from "@/lib/formats/single-elim";
import type { CompetitionEntry } from "@/db/schema/competition-entries";

function makeTeams(n: number): CompetitionEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `entry-${i}`,
    name: `战队 ${i + 1}`,
    competitionId: "season-1",
    formationOrder: i + 1,
  } as unknown as CompetitionEntry));
}

const config = {
  key: "playoff",
  name: "淘汰赛",
  type: "single_elim" as const,
  teamCount: 4,
  advanceTiers: [{ placement: "1st", count: 1 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockInsertValues.mockResolvedValue(undefined);
  mockInsert.mockReturnValue({ values: mockInsertValues });
  mockSaveStageBracketState.mockResolvedValue(undefined);
  mockMatchFindMany.mockResolvedValue([]);
});

describe("singleElimExecutor", () => {
  it("initializes only the requested logical stage and writes entry ids directly", async () => {
    mockCreateStageBracket.mockResolvedValue({
      data: { stage: [], match: [], participant: [], round: [], group: [], match_game: [] },
      resolvedMatches: [
        { bracketMatchId: 1, stageId: 1, entryAId: "entry-0", entryBId: "entry-3", roundNumber: 1, groupNumber: 1 },
        { bracketMatchId: 2, stageId: 1, entryAId: "entry-1", entryBId: "entry-2", roundNumber: 1, groupNumber: 1 },
      ],
    });

    const result = await singleElimExecutor.initialize("season-1", config, makeTeams(4));

    expect(mockCreateStageBracket).toHaveBeenCalledWith(config, expect.any(Array));
    expect(mockSaveStageBracketState).toHaveBeenCalledWith(
      expect.anything(), "season-1", "playoff", expect.anything(),
    );
    expect(mockEnsureResolvedBracketMatch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      seasonId: "season-1",
      stageKey: "playoff",
      format: "bo3",
      entryRound: "semifinal",
      resolved: expect.objectContaining({
        entryAId: "entry-0",
        entryBId: "entry-3",
        bracketMatchId: 1,
      }),
    }));
    expect(result).toEqual({ matchCount: 2 });
  });

  it("derives qualifiers from the canonical final match", async () => {
    mockMatchFindMany.mockResolvedValue([{
      entryAId: "winner",
      entryBId: "loser",
      scoreA: 2,
      scoreB: 1,
      entryRound: "final",
    }]);
    await expect(singleElimExecutor.getQualifiers("season-1", config)).resolves.toEqual([
      { teamId: "winner", placement: "1st" },
    ]);
  });
});

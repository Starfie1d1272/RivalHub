import { describe, expect, it, vi } from "vitest";

const { mockSelect, mockMatchesFindMany } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockMatchesFindMany: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    select: mockSelect,
    query: { matches: { findMany: mockMatchesFindMany } },
  },
}));

vi.mock("@/db/schema", () => ({
  competitionEntries: { id: {}, name: {} },
  majorStageEntrants: { stageSeed: {}, tournamentEntrantId: {}, stageRunId: {} },
  majorStageRuns: { seasonId: {}, stageKey: {} },
  majorTournamentEntrants: { id: {}, competitionEntryId: {} },
  matches: { seasonId: {}, stage: {}, majorStageRunId: {}, ownership: {}, round: {}, createdAt: {} },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  asc: vi.fn(),
  eq: vi.fn(),
}));

import { loadMajorSwissStageReadModel } from "./stage-read-model";

function makeRoundMatches() {
  const r1 = [
    ["team-1", "team-9"], ["team-2", "team-10"], ["team-3", "team-11"], ["team-4", "team-12"],
    ["team-5", "team-13"], ["team-6", "team-14"], ["team-7", "team-15"], ["team-8", "team-16"],
  ];
  const r2 = [
    ["team-1", "team-8"], ["team-2", "team-7"], ["team-3", "team-6"], ["team-4", "team-5"],
    ["team-9", "team-16"], ["team-10", "team-15"], ["team-11", "team-14"], ["team-12", "team-13"],
  ];
  return [...r1.map((pair, index) => ({ id: `r1-${index + 1}`, entryAId: pair[0]!, entryBId: pair[1]!, round: 1, scoreA: 1, scoreB: 0 })),
    ...r2.map((pair, index) => ({ id: `r2-${index + 1}`, entryAId: pair[0]!, entryBId: pair[1]!, round: 2, scoreA: 1, scoreB: 0 }))]
    .map((match) => ({ ...match, status: "finished", completedAt: new Date(), format: "bo1", createdAt: new Date() }));
}

describe("Major Swiss stage read model", () => {
  it("uses the frozen stage name and pre-round records for historical columns", async () => {
    const chain = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
    };
    chain.from.mockReturnValue(chain);
    chain.innerJoin.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.orderBy.mockResolvedValue(Array.from({ length: 16 }, (_, index) => ({
      entryId: `team-${index + 1}`,
      seed: index + 1,
      teamName: `Team ${index + 1}`,
    })));
    chain.limit.mockResolvedValue([{
      id: "run-1",
      stageKey: "stage1",
      finalizedRound: 2,
      ruleSnapshot: {
        version: 4,
        stagePlan: [{ key: "stage1", name: "冻结瑞士轮", type: "swiss", teamCount: 16, matchFormat: "bo1", finalFormat: null, advanceTiers: [] }],
        rosterRules: { minTeamSize: 5, maxTeamSize: 5, starterCount: 5 },
        affiliationRules: [],
        competitiveProfile: null,
        frozenCompetitiveFacts: [],
        runOptions: {},
      },
    }]);
    mockSelect.mockReturnValue(chain);
    mockMatchesFindMany.mockResolvedValue(makeRoundMatches());

    const data = await loadMajorSwissStageReadModel("season-1", "stage1");

    expect(data?.stageName).toBe("冻结瑞士轮");
    expect(data?.rounds[0]?.groups.map((group) => group.record)).toEqual(["0:0"]);
    expect(data?.rounds[1]?.groups.map((group) => group.record)).toContain("1:0");
  });
});

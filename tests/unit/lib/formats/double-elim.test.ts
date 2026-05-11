import { describe, expect, it, vi, beforeEach } from "vitest";

// ── mock db ───────────────────────────────────────────────────────────────────
const { mockMatchFindMany, mockSelectWhere } = vi.hoisted(() => ({
  mockMatchFindMany: vi.fn(),
  mockSelectWhere: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: mockSelectWhere,
      }),
    }),
    query: {
      matches: { findMany: mockMatchFindMany },
    },
  },
}));

vi.mock("@/db/schema", () => ({
  matches: { id: {}, seasonId: {}, stage: {}, status: {}, teamAId: {}, teamBId: {}, scoreA: {}, scoreB: {}, createdAt: {}, entryRound: {} },
  seasons: { id: {}, bracketData: {}, stagePlan: {} },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  count: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray, ..._args: unknown[]) => strings.join("")),
  desc: vi.fn(),
}));

import { doubleElimExecutor } from "@/lib/formats/double-elim";

function finishedMatch(overrides: Record<string, unknown> = {}) {
  return {
    id: "m-final",
    seasonId: "season-1",
    teamAId: "t1",
    teamBId: "t2",
    status: "finished" as const,
    scoreA: 2,
    scoreB: 0,
    stage: "playoff",
    createdAt: new Date(),
    entryRound: "final",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectWhere.mockResolvedValue([{ value: 0 }]);
});

describe("doubleElimExecutor", () => {
  describe("isComplete()", () => {
    it("所有比赛 finished (active=0 且 total>0) 返回 true", async () => {
      mockSelectWhere
        .mockResolvedValueOnce([{ value: 6 }])  // total
        .mockResolvedValueOnce([{ value: 0 }]);  // active
      const result = await doubleElimExecutor.isComplete("season-1", "playoff");
      expect(result).toBe(true);
    });

    it("存在 scheduled 比赛返回 false", async () => {
      mockSelectWhere
        .mockResolvedValueOnce([{ value: 6 }])
        .mockResolvedValueOnce([{ value: 1 }]);  // 1 still active
      const result = await doubleElimExecutor.isComplete("season-1", "playoff");
      expect(result).toBe(false);
    });

    it("无比赛返回 false", async () => {
      mockSelectWhere.mockResolvedValueOnce([{ value: 0 }]);
      const result = await doubleElimExecutor.isComplete("season-1", "playoff");
      expect(result).toBe(false);
    });
  });

  describe("getQualifiers()", () => {
    it("决赛完成后返回冠军和亚军", async () => {
      mockMatchFindMany.mockResolvedValue([
        finishedMatch({ id: "m-final", scoreA: 2, scoreB: 1, teamAId: "t1", teamBId: "t2", createdAt: new Date("2026-06-02") }),
        finishedMatch({ id: "m-wb-final", scoreA: 2, scoreB: 0, createdAt: new Date("2026-06-01") }),
      ]);
      const result = await doubleElimExecutor.getQualifiers("season-1", {
        key: "playoff",
        name: "淘汰赛",
        type: "double_elim" as const,
        teamCount: 8,
        advanceTiers: [{ placement: "2nd" as const, count: 1 }],
      });
      expect(result).toHaveLength(2);
      expect(result[0].teamId).toBe("t1");
      expect(result[0].placement).toBe("1st");
      expect(result[1].teamId).toBe("t2");
      expect(result[1].placement).toBe("2nd");
    });

    it("无比赛时返回空数组", async () => {
      mockMatchFindMany.mockResolvedValue([]);
      const result = await doubleElimExecutor.getQualifiers("season-1", {
        key: "playoff",
        name: "淘汰赛",
        type: "double_elim" as const,
        teamCount: 8,
      });
      expect(result).toEqual([]);
    });
  });
});

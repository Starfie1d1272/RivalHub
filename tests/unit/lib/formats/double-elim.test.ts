import { describe, expect, it, vi, beforeEach } from "vitest";

// ── mock db ───────────────────────────────────────────────────────────────────
const { mockMatchFindMany } = vi.hoisted(() => ({
  mockMatchFindMany: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    query: {
      matches: { findMany: mockMatchFindMany },
    },
  },
}));

vi.mock("@/db/schema", () => ({
  matches: { id: {}, seasonId: {}, stage: {}, status: {}, entryAId: {}, entryBId: {}, scoreA: {}, scoreB: {}, createdAt: {}, entryRound: {} },
  matchMaps: { matchId: {}, scoreA: {}, scoreB: {} },
  seasons: { id: {}, stagePlan: {} },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
  isNotNull: vi.fn(),
  count: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray) => strings.join("")),
  desc: vi.fn(),
}));

import { doubleElimExecutor } from "@/lib/formats/double-elim";

function finishedMatch(overrides: Record<string, unknown> = {}) {
  return {
    id: "m-final",
    seasonId: "season-1",
    entryAId: "t1",
    entryBId: "t2",
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
});

describe("doubleElimExecutor", () => {
  describe("getQualifiers()", () => {
    it("决赛完成后返回冠军和亚军", async () => {
      mockMatchFindMany.mockResolvedValue([
        finishedMatch({ id: "m-final", scoreA: 2, scoreB: 1, entryAId: "t1", entryBId: "t2", createdAt: new Date("2026-06-02") }),
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
        advanceTiers: [],
      });
      expect(result).toEqual([]);
    });
  });
});

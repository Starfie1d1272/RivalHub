import { describe, expect, it, vi, beforeEach } from "vitest";

// ── mock db ───────────────────────────────────────────────────────────────────
const { mockMatchFindMany, mockEntriesFindMany, mockSelectWhere } = vi.hoisted(() => ({
  mockMatchFindMany: vi.fn(),
  mockEntriesFindMany: vi.fn(),
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
      competitionEntries: { findMany: mockEntriesFindMany },
    },
  },
}));

vi.mock("@/db/schema", () => ({
  matches: { id: {}, seasonId: {}, stage: {}, status: {}, entryAId: {}, entryBId: {}, scoreA: {}, scoreB: {} },
  matchMaps: { matchId: {}, scoreA: {}, scoreB: {} },
  competitionEntries: { id: {}, name: {}, competitionId: {}, draftOrder: {} },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
  isNotNull: vi.fn(),
  count: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray) => strings.join("")),
}));

import { roundRobinExecutor } from "@/lib/formats/round-robin";

const mockConfig = {
  key: "round-robin",
  name: "单循环排位赛",
  type: "round_robin" as const,
  teamCount: 8,
  advanceTiers: [
    { placement: "*" as const, count: 8 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectWhere.mockResolvedValue([{ value: 0 }]);
});

describe("roundRobinExecutor", () => {
  describe("isComplete()", () => {
    it("所有比赛 finished (active=0) 且 total>0 时返回 true", async () => {
      // first call: total count, second call: active count
      mockSelectWhere
        .mockResolvedValueOnce([{ value: 8 }])  // total
        .mockResolvedValueOnce([{ value: 0 }]);  // active
      const result = await roundRobinExecutor.isComplete("season-1", "round-robin");
      expect(result).toBe(true);
    });

    it("存在 active 比赛返回 false", async () => {
      mockSelectWhere
        .mockResolvedValueOnce([{ value: 8 }])
        .mockResolvedValueOnce([{ value: 2 }]);  // 2 still active
      const result = await roundRobinExecutor.isComplete("season-1", "round-robin");
      expect(result).toBe(false);
    });

    it("total 为 0 时返回 false（无比赛）", async () => {
      mockSelectWhere
        .mockResolvedValueOnce([{ value: 0 }]);  // total = 0 → early return
      const result = await roundRobinExecutor.isComplete("season-1", "round-robin");
      expect(result).toBe(false);
    });
  });

  describe("getQualifiers()", () => {
    it("返回按排名排序的前 N 支队", async () => {
      // t1 2-0, t2 1-1, t3 0-2
      mockEntriesFindMany.mockResolvedValue([
        { id: "t1", name: "A队", competitionId: "season-1", draftOrder: 1 },
        { id: "t2", name: "B队", competitionId: "season-1", draftOrder: 2 },
        { id: "t3", name: "C队", competitionId: "season-1", draftOrder: 3 },
      ]);

      mockMatchFindMany.mockResolvedValue([
        { id: "m1", seasonId: "season-1", entryAId: "t1", entryBId: "t2", status: "finished", scoreA: 1, scoreB: 0, stage: "round-robin" },
        { id: "m2", seasonId: "season-1", entryAId: "t1", entryBId: "t3", status: "finished", scoreA: 1, scoreB: 0, stage: "round-robin" },
        { id: "m3", seasonId: "season-1", entryAId: "t2", entryBId: "t3", status: "finished", scoreA: 1, scoreB: 0, stage: "round-robin" },
      ]);

      const result = await roundRobinExecutor.getQualifiers("season-1", {
        ...mockConfig,
        advanceTiers: [{ placement: "*" as const, count: 2 }],
      });
      expect(result).toHaveLength(2);
      expect(result[0].teamId).toBe("t1");
      expect(result[1].teamId).toBe("t2");
    });

    it("无 advanceTiers 时返回空数组", async () => {
      mockEntriesFindMany.mockResolvedValue([]);
      const result = await roundRobinExecutor.getQualifiers("season-1", {
        ...mockConfig,
        advanceTiers: [],
      });
      expect(result).toEqual([]);
    });
  });
});

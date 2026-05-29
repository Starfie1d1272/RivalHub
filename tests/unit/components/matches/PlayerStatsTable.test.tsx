import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockFindMany } = vi.hoisted(() => ({ mockFindMany: vi.fn() }));

vi.mock("@/db/client", () => ({
  db: {
    query: {
      matchPlayerStats: { findMany: mockFindMany },
      matchMaps: { findFirst: vi.fn().mockResolvedValue(null) },
      seasonRegistrations: { findMany: vi.fn().mockResolvedValue([]) },
      teamMembers: { findMany: vi.fn().mockResolvedValue([]) },
    },
  },
}));

vi.mock("@/db/schema/player-stats", () => ({
  matchPlayerStats: {
    id: {}, mapId: {}, userId: {}, perfectName: {},
    kills: {}, deaths: {}, assists: {}, adr: {}, ratingPro: {},
    hsPercent: {}, firstKills: {}, multiKills: {}, clutches: {},
    rws: {}, we: {},
  },
  statSourceEnum: () => {},
}));

vi.mock("@/db/schema/teams", () => ({
  teamMembers: { registrationId: {}, teamId: {} },
}));

vi.mock("@/db/schema/match-maps", () => ({
  matchMaps: {
    id: {}, matchId: {}, mapName: {}, mapOrder: {},
    scoreA: {}, scoreB: {}, activeStatSource: {},
  },
}));

vi.mock("@/db/schema/registrations", () => ({
  seasonRegistrations: { id: {}, userId: {}, seasonId: {} },
}));

import { PlayerStatsTable } from "@/components/matches/PlayerStatsTable";

const baseProps = {
  mapId: "mp1",
  teamAId: "ta",
  teamBId: "tb",
  teamAName: "队伍 A",
  teamBName: "队伍 B",
  seasonId: "s1",
  seasonSlug: "test",
};

describe("PlayerStatsTable", () => {
  it("renders empty state when no stats", async () => {
    mockFindMany.mockResolvedValue([]);
    const jsx = await PlayerStatsTable(baseProps);
    render(jsx);
    expect(screen.getByText("暂无玩家数据")).toBeDefined();
  });

  it("renders team names and player names", async () => {
    mockFindMany.mockResolvedValue([
      { id: "p1", userId: null, perfectName: "选手1", kills: 10, deaths: 5, assists: 3, adr: 80, ratingPro: 1.1, hsPercent: 50, firstKills: 2, multiKills: 1, clutches: 0, rws: 12, we: 1.5 },
      { id: "p2", userId: null, perfectName: "选手2", kills: 5, deaths: 10, assists: 1, adr: 50, ratingPro: 0.8, hsPercent: 40, firstKills: 0, multiKills: 0, clutches: 0, rws: 8, we: 0.8 },
    ]);
    const jsx = await PlayerStatsTable(baseProps);
    render(jsx);
    expect(screen.getByText("选手1")).toBeDefined();
    expect(screen.getByText("选手2")).toBeDefined();
    expect(screen.getByText("队伍 A")).toBeDefined();
    expect(screen.getByText("队伍 B")).toBeDefined();
  });

  it("renders rating values", async () => {
    mockFindMany.mockResolvedValue([
      { id: "p1", userId: null, perfectName: "高Rating选手", kills: 25, deaths: 8, assists: 5, adr: 95, ratingPro: 1.35, hsPercent: 60, firstKills: 3, multiKills: 2, clutches: 1, rws: 15, we: 2.0 },
    ]);
    const jsx = await PlayerStatsTable(baseProps);
    render(jsx);
    expect(screen.getByText("1.35")).toBeDefined();
  });
});

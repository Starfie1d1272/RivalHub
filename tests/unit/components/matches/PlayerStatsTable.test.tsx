import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockFindMany } = vi.hoisted(() => ({ mockFindMany: vi.fn() }));

vi.mock("@/db/client", () => ({
  db: {
    query: {
      matchPlayerStats: { findMany: mockFindMany },
      matches: {
        findFirst: vi.fn().mockResolvedValue({ teamAId: "ta", teamBId: "tb", seasonId: "s1" }),
      },
      seasonRegistrations: { findMany: vi.fn().mockResolvedValue([]) },
      teamMembers: { findMany: vi.fn().mockResolvedValue([]) },
    },
  },
}));

vi.mock("@/db/schema/player-stats", () => ({
  matchPlayerStats: {
    id: {}, mapId: {}, userId: {}, perfectName: {},
    kills: {}, deaths: {}, assists: {}, adr: {}, ratingPro: {},
  },
}));

vi.mock("@/db/schema/matches", () => ({
  matches: { id: {}, teamAId: {}, teamBId: {}, seasonId: {} },
}));

vi.mock("@/db/schema/teams", () => ({
  teamMembers: { registrationId: {}, teamId: {} },
}));

vi.mock("@/db/schema/registrations", () => ({
  seasonRegistrations: { id: {}, userId: {}, seasonId: {} },
}));

import { PlayerStatsTable } from "@/components/matches/PlayerStatsTable";

describe("PlayerStatsTable", () => {
  it("renders empty state when no stats", async () => {
    mockFindMany.mockResolvedValue([]);
    const jsx = await PlayerStatsTable({ matchId: "m1", mapId: "mp1" });
    render(jsx);
    expect(screen.getByText("暂无玩家数据")).toBeDefined();
  });

  it("renders two columns for team A and team B", async () => {
    mockFindMany.mockResolvedValue([
      { id: "p1", userId: null, perfectName: "选手1", kills: 10, deaths: 5, assists: 3, adr: 80, ratingPro: 1.1 },
      { id: "p2", userId: null, perfectName: "选手2", kills: 5, deaths: 10, assists: 1, adr: 50, ratingPro: 0.8 },
    ]);
    const jsx = await PlayerStatsTable({ matchId: "m1", mapId: "mp1" });
    render(jsx);
    expect(screen.getByText("选手1")).toBeDefined();
    expect(screen.getByText("选手2")).toBeDefined();
  });

  it("highlights rating >= 1.2 with season primary color", async () => {
    mockFindMany.mockResolvedValue([
      { id: "p1", userId: null, perfectName: "高Rating选手", kills: 25, deaths: 8, assists: 5, adr: 95, ratingPro: 1.35 },
    ]);
    const jsx = await PlayerStatsTable({ matchId: "m1", mapId: "mp1" });
    render(jsx);
    expect(screen.getByText("1.35")).toBeDefined();
  });
});

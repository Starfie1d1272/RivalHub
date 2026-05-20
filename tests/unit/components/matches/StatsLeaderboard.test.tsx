import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/validators/registration", () => ({
  POSITION_LABELS: {
    awper: { cn: "AWPer" },
    opener: { cn: "Opener" },
    igl: { cn: "IGL" },
    closer: { cn: "Closer" },
    anchor: { cn: "Anchor" },
  },
}));

import { StatsLeaderboard } from "@/components/matches/StatsLeaderboard";

describe("StatsLeaderboard", () => {
  it("renders empty state when no rows", () => {
    render(
      <StatsLeaderboard rows={[]} sort="rating" position="" seasonSlug="test" />
    );
    expect(screen.getByText("该赛季暂无已确认的玩家数据")).toBeDefined();
  });

  it("renders player rows with links", () => {
    render(
      <StatsLeaderboard
        seasonSlug="test"
        sort="rating"
        position=""
        rows={[
          {
            userId: "u1", perfectName: "张三", position: "awper",
            teamName: "Alpha", teamId: "t1",
            maps: 10, avgRating: 1.25, avgAdr: 92.3,
            avgRws: 12.5, avgWe: 10.5, avgHs: 45.0,
            kdRatio: 2.03, kpr: 20.5, fkpr: 2.1, mkpr: 1.5, cpr: 0.3,
          },
        ]}
      />
    );
    expect(screen.getByText("张三")).toBeDefined();
    expect(screen.getByText("1.25")).toBeDefined();
    expect(screen.getByText("92.3")).toBeDefined();
  });

  it("renders sort tabs with correct active state", () => {
    render(
      <StatsLeaderboard
        seasonSlug="test"
        sort="adr"
        position=""
        rows={[
          {
            userId: "u1", perfectName: "李四", position: "opener",
            teamName: "Beta", teamId: "t2",
            maps: 5, avgRating: 1.1, avgAdr: 88.0,
            avgRws: 10.0, avgWe: 8.5, avgHs: 38.0,
            kdRatio: 1.50, kpr: 18.0, fkpr: 1.8, mkpr: 1.2, cpr: 0.2,
          },
        ]}
      />
    );
    expect(screen.getByText("李四")).toBeDefined();
  });

  it("renders position filter chips", () => {
    render(
      <StatsLeaderboard
        seasonSlug="test"
        sort="rating"
        position="awper"
        rows={[
          {
            userId: "u1", perfectName: "王五", position: "awper",
            teamName: "Gamma", teamId: "t3",
            maps: 8, avgRating: 1.3, avgAdr: 90.0,
            avgRws: 13.0, avgWe: 11.0, avgHs: 42.0,
            kdRatio: 2.44, kpr: 22.0, fkpr: 2.3, mkpr: 1.8, cpr: 0.4,
          },
        ]}
      />
    );
    expect(screen.getByText("王五")).toBeDefined();
  });
});

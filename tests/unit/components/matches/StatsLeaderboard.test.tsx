/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/validators/registration", () => ({
  positionLabel: (position: string) => ({
    awper: "AWPer",
    opener: "Opener",
    igl: "IGL",
    closer: "Closer",
    anchor: "Anchor",
  })[position] ?? position,
}));

import { StatsLeaderboard } from "@/components/matches/StatsLeaderboard";

describe("StatsLeaderboard", () => {
  it("renders empty state when no rows", () => {
    render(
      <StatsLeaderboard rows={[]} sort="rating" position="" seasonSlug="test" />
    );
    expect(screen.getByText("该赛季暂无已确认的玩家数据")).toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: "张三" })).toHaveAttribute("href", "/players/u1");
    expect(screen.getByRole("link", { name: "Alpha" })).toHaveAttribute("href", "/test/teams/t1");
    expect(screen.getByRole("cell", { name: "1.25" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "92.3" })).toBeInTheDocument();
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
    const adr = screen.getByRole("link", { name: "ADR" });
    expect(adr).toHaveAttribute("href", "/test/stats?sort=adr");
    expect(adr).toHaveClass("border-input");
    expect(screen.getByRole("link", { name: "Rating" })).not.toHaveClass("border-input");
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
    expect(screen.getByRole("link", { name: "AWPer" })).toHaveAttribute("href", "/test/stats?sort=rating&position=awper");
    expect(screen.getByRole("link", { name: "王五" })).toHaveAttribute("href", "/players/u1");
  });

  it("renders unknown metrics as em dashes and preserves real zero", () => {
    render(
      <StatsLeaderboard
        seasonSlug="test"
        sort="rating"
        position=""
        rows={[
          {
            userId: "u-null", perfectName: "Unknown", position: null,
            teamName: null, teamId: null,
            maps: 1, avgRating: null, avgAdr: null, avgRws: null, avgWe: null, avgHs: null,
            kdRatio: null, kpr: null, fkpr: null, mkpr: null, cpr: null,
          },
          {
            userId: "u-zero", perfectName: "Zero", position: null,
            teamName: null, teamId: null,
            maps: 1, avgRating: 0, avgAdr: 0, avgRws: 0, avgWe: 0, avgHs: 0,
            kdRatio: 0, kpr: 0, fkpr: 0, mkpr: 0, cpr: 0,
          },
        ]}
      />,
    );

    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(5);
    expect(screen.getAllByText("0.00").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });
});

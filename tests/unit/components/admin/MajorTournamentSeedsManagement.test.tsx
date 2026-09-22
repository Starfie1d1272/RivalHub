/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MajorTournamentSeedsManagement, type MajorTournamentSeedsManagementData } from "@/components/admin/MajorTournamentSeedsManagement";

Object.assign(globalThis, { React });

vi.mock("@/actions/major-prestart", () => ({
  confirmMajorTournamentSeeds: vi.fn(),
  saveMajorTournamentSeeds: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const data: MajorTournamentSeedsManagementData = {
  seasonId: "season-1",
  entrantsLocked: true,
  entrants: [{ teamId: "team-1", teamName: "Team One" }],
  seeds: [],
  seedsConfirmed: false,
  recommendationStatus: "ready",
  recommendation: {
    version: 1,
    generatedAt: "2026-09-13T00:00:00.000Z",
    platform: "perfect_world",
    conversionPolicyId: null,
    conversionPolicyVersion: null,
    teams: [{
      entrantId: "entrant-1",
      teamId: "team-1",
      teamName: "Team One",
      available: true,
      blockers: [],
      recommendationRank: 1,
      tieState: "not_tied",
      starters: [{
        userId: "player-1",
        label: "Player One",
        presentation: {
          historicalPeak: { rank: "黄金S", stars: 10, sourcePlatform: "fivee", sourceSeasonKey: "5E-S20", sourceRank: "S", sourceStars: 10, conversionVersion: "v1" },
          referenceSeasonPeak: { rank: "A", stars: null, sourcePlatform: null, sourceSeasonKey: null, sourceRank: null, sourceStars: null, conversionVersion: null },
          currentSeasonPeak: { rank: "A+", stars: null, sourcePlatform: null, sourceSeasonKey: null, sourceRank: null, sourceStars: null, conversionVersion: null },
          recentPeak: { rank: "A++", stars: null, sourcePlatform: null, sourceSeasonKey: null, sourceRank: null, sourceStars: null, conversionVersion: null },
          historicalRating: 1000,
          available: true,
          blockers: [],
        },
      }],
      finalSeed: null,
      finalOrderStatus: "unsaved",
    }],
  },
  firstRound: null,
};

describe("MajorTournamentSeedsManagement", () => {
  it("keeps frozen strength references semantic and omits score and tie-group internals", () => {
    render(<MajorTournamentSeedsManagement data={data} />);

    expect(screen.getByText("#1 · Team One")).toBeVisible();
    expect(screen.getAllByText("系统参考顺序").length).toBeGreaterThan(0);
    expect(screen.getByText("历史 黄金S · 10 星")).toBeVisible();
    expect(screen.getByRole("link", { name: "Player One" })).toHaveAttribute("href", "/players/player-1");
    expect(screen.getByText("参考 A")).toBeVisible();
    expect(screen.getByText("近期 A++")).toBeVisible();
    expect(screen.getByText("历史 Rating 1000")).toBeInTheDocument();
    expect(screen.queryByText("12.34")).not.toBeInTheDocument();
    expect(screen.queryByText(/并列组/)).not.toBeInTheDocument();
    expect(screen.queryByText(/综合|历史\/前一赛季\/近期参考/)).not.toBeInTheDocument();
  });

  it("explains entry cohorts by seed ranges without duplicating the full order", () => {
    const entrants = Array.from({ length: 32 }, (_, index) => ({
      teamId: `team-${index + 1}`,
      teamName: `Team ${index + 1}`,
    }));
    const seeds = entrants.map((entrant, index) => ({ ...entrant, tournamentSeed: index + 1 }));

    render(<MajorTournamentSeedsManagement data={{
      ...data,
      entrants,
      seeds,
      recommendationStatus: "missing",
      recommendation: null,
      firstRound: null,
    }} />);

    const cohorts = screen.getByRole("heading", { name: "入场批次" }).closest("section");
    expect(cohorts).toHaveTextContent("#1–8");
    expect(cohorts).toHaveTextContent("#9–16");
    expect(cohorts).toHaveTextContent("#17–32");
    expect(cohorts).not.toHaveTextContent("Team 1");
    expect(screen.getByText("Team 1")).toBeInTheDocument();
  });
});

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
  entrantCapacity: 32,
  firstSwissStageName: "阶段一",
  entryCohorts: [
    { stageKey: "stage3", stageName: "阶段三", fromSeed: 1, toSeed: 8 },
    { stageKey: "stage2", stageName: "阶段二", fromSeed: 9, toSeed: 16 },
    { stageKey: "stage1", stageName: "阶段一", fromSeed: 17, toSeed: 32 },
  ],
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

  it("renders the 24-team capacity and its two configured seed cohorts", () => {
    const entrants = Array.from({ length: 24 }, (_, index) => ({ teamId: `team-${index + 1}`, teamName: `Team ${index + 1}` }));
    const seeds = entrants.map((entrant, index) => ({ ...entrant, tournamentSeed: index + 1 }));
    render(<MajorTournamentSeedsManagement data={{
      ...data,
      entrantCapacity: 24,
      firstSwissStageName: "阶段一",
      entryCohorts: [
        { stageKey: "stage2", stageName: "阶段二", fromSeed: 1, toSeed: 8 },
        { stageKey: "stage1", stageName: "阶段一", fromSeed: 9, toSeed: 24 },
      ],
      entrants,
      seeds,
      recommendationStatus: "missing",
      recommendation: null,
      firstRound: Array.from({ length: 8 }, (_, index) => ({ higherSeed: index + 9, lowerSeed: index + 17, format: "bo3" as const })),
    }} />);

    expect(screen.getByText("赛事 1–24 种子")).toBeInTheDocument();
    const cohorts = screen.getByRole("heading", { name: "入场批次" }).closest("section");
    expect(cohorts).toHaveTextContent("#1–8");
    expect(cohorts).toHaveTextContent("#9–24");
    expect(cohorts).not.toHaveTextContent("Stage 3");
    expect(screen.getByRole("heading", { name: "阶段一 首轮预览" })).toBeVisible();
    expect(screen.getAllByText(/BO3/)).toHaveLength(8);
  });
});

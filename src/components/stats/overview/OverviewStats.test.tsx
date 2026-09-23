import React from "react";
import { render, screen, within } from "@testing-library/react";
import { buildTournamentAnalytics, buildTournamentPerformanceAnalytics } from "@cs2dak/tournament";
import { describe, expect, it, vi } from "vitest";
import type { TournamentStats } from "@/lib/stats/tournament-query";
import { parseStatsQuery } from "@/lib/stats/view-state";
import { OverviewStats } from "./OverviewStats";
vi.mock("next/link", async () => { const React = await import("react"); return { default: ({ href, scroll, ...props }: { href: string; scroll?: boolean; [key: string]: unknown }) => React.createElement("a", { href, "data-scroll": String(scroll), ...props }) }; });
function dataWithCoverage(detailedMaps: number, completedMaps: number) {
  const labels = { teams: {}, players: {} };
  return { leaderboard: [], analytics: buildTournamentAnalytics([], { labels }), performance: buildTournamentPerformanceAnalytics([], { labels }),
    results: { totals: { completedMatches: 3, completedMaps, completedRounds: 154 }, teams: [], maps: [{ mapName: "de_ancient", played: completedMaps, rounds: 154 }], teamMaps: [] },
    selection: [], teamRatings: [], coverage: { detailedMaps, completedMaps, maps: [{ mapName: "de_ancient", completedMaps, detailedMaps }] }, options: { teams: [], maps: ["de_ancient"] },
  } as unknown as TournamentStats;
}
describe("OverviewStats", () => {
  it("keeps map exposure and coverage visible when detail is partial", () => {
    render(<OverviewStats data={dataWithCoverage(4, 7)} query={parseStatsQuery({}, [])} seasonSlug="major" />);
    const mapTable = screen.getAllByRole("table")[0]!;
    expect(within(mapTable).getByRole("link", { name: "Ancient" })).toHaveAttribute("data-scroll", "false");
    expect(within(mapTable).getByText("7")).toBeInTheDocument(); expect(within(mapTable).getByText("4/7")).toBeInTheDocument();
    expect(screen.getByText("Economy & Conversion")).toBeInTheDocument();
  });
  it("hides coverage chrome when every completed map has detail", () => {
    render(<OverviewStats data={dataWithCoverage(7, 7)} query={parseStatsQuery({}, [])} seasonSlug="major" />);
    expect(screen.queryByRole("columnheader", { name: "Coverage" })).not.toBeInTheDocument(); expect(screen.queryByText("7/7")).not.toBeInTheDocument();
  });
  it("shows canonical map rounds and ranked top-list headings", () => {
    const data = dataWithCoverage(7, 7);
    data.leaderboard = [{ userId: "00000000-0000-0000-0000-000000000001", perfectName: "Alpha", teamId: null, teamName: null, maps: 7, rounds: 154, avgRating: 1.2 }] as TournamentStats["leaderboard"];
    data.results.teams = [{ entryId: "team-a", name: "Alpha Team", matches: 3, matchWins: 2, matchLosses: 1, maps: 7, mapWins: 4, mapLosses: 3 }];
    data.teamRatings = [{ entryId: "team-a", rating: 1.11, ratingSamples: 35 }];
    render(<OverviewStats data={data} query={parseStatsQuery({}, [])} seasonSlug="major" />);
    const mapTable = screen.getAllByRole("table")[0]!;
    expect(within(mapTable).getByRole("columnheader", { name: "Rounds" })).toBeInTheDocument();
    expect(within(mapTable).queryByRole("columnheader", { name: "Picks" })).not.toBeInTheDocument();
    expect(within(mapTable).queryByRole("columnheader", { name: "Bans" })).not.toBeInTheDocument();
    expect(within(mapTable).getByText("154")).toBeInTheDocument();
    expect(screen.getByText("Top Players")).toBeInTheDocument();
    expect(screen.getByText("Top Teams")).toBeInTheDocument();
    expect(screen.getByText("Top Weapons")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader", { name: /^Rating/ })).toHaveLength(2);
    expect(screen.getByRole("columnheader", { name: "Maps / Rds" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "W-L" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /^Share/ })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader", { name: "#" })).toHaveLength(3);
    const leaderTables = screen.getAllByRole("table").slice(1, 4);
    expect(leaderTables.every((table) => !table.className.includes("min-w-["))).toBe(true);
  });

  it("shows only Eco, Semi and Force versus Full Buy and renders nine best-rate highlights", () => {
    const data = dataWithCoverage(7, 7);
    data.analytics.economyMatrix = [
      { lowEconomy: "eco", highEconomy: "full", rounds: 10, lowEconomyWins: 1, lowWinRate: 0.1 },
      { lowEconomy: "semi", highEconomy: "full", rounds: 20, lowEconomyWins: 4, lowWinRate: 0.2 },
      { lowEconomy: "force", highEconomy: "full", rounds: 30, lowEconomyWins: 9, lowWinRate: 0.3 },
      { lowEconomy: "eco", highEconomy: "force", rounds: 8, lowEconomyWins: 2, lowWinRate: 0.25 },
      { lowEconomy: "pistol", highEconomy: "full", rounds: 2, lowEconomyWins: 1, lowWinRate: 0.5 },
    ];
    data.analytics.teams = [{
      team: { entityKey: "team-a", displayName: "Alpha Team" }, mapCount: 7, rounds: 100, roundWins: 60, roundWinRate: 0.6,
      t: { wins: 30, opportunities: 50, rate: 0.6 }, ct: { wins: 30, opportunities: 50, rate: 0.6 }, pistol: { wins: 8, opportunities: 14, rate: 8 / 14 },
      round2: { conversion: { wins: 7, opportunities: 8, rate: 7 / 8 }, break: { wins: 3, opportunities: 6, rate: 0.5 } },
      ecoSemiUpset: { wins: 5, opportunities: 20, rate: 0.25 },
      manAdvantage: {
        "5v4": { wins: 12, opportunities: 15, rate: 0.8 }, "4v5": { wins: 3, opportunities: 10, rate: 0.3 },
        "5v3": { wins: 5, opportunities: 6, rate: 5 / 6 }, "3v5": { wins: 1, opportunities: 5, rate: 0.2 },
      },
    }];
    render(<OverviewStats data={data} query={parseStatsQuery({}, [])} seasonSlug="major" />);
    const economySection = screen.getByText("Economy vs Full Buy").closest("section")!;
    expect(within(economySection).getByText("Eco")).toBeInTheDocument();
    expect(within(economySection).getByText("Semi")).toBeInTheDocument();
    expect(within(economySection).getByText("Force")).toBeInTheDocument();
    expect(within(economySection).queryByText("Pistol")).not.toBeInTheDocument();
    expect(screen.getAllByText("Alpha Team")).toHaveLength(9);
    expect(screen.getByText("5v3 Conversion")).toBeInTheDocument();
    expect(screen.getByText("3v5 Comeback")).toBeInTheDocument();
  });

  it("renders visual side splits and full-list navigation", () => {
    const data = dataWithCoverage(7, 7);
    data.analytics.totals.ct = { rate: 0.55, wins: 55, opportunities: 100 };
    data.analytics.totals.t = { rate: 0.45, wins: 45, opportunities: 100 };
    render(<OverviewStats data={data} query={parseStatsQuery({}, [])} seasonSlug="major" />);
    expect(screen.getByLabelText("CT 55.0%, T 45.0%")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "View all →" })).toHaveLength(3);
  });

  it("makes CT / T sortable by CT win rate", () => {
    render(<OverviewStats data={dataWithCoverage(7, 7)} query={parseStatsQuery({}, [])} seasonSlug="major" />);
    expect(screen.getByRole("button", { name: "Sort by CT / T" })).toBeInTheDocument();
  });

});

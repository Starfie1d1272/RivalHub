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
    expect(screen.getByText("Round Context")).toBeInTheDocument();
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
    expect(screen.getAllByRole("columnheader", { name: "#" })).toHaveLength(3);
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

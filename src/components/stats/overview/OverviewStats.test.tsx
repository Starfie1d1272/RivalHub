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
    results: { totals: { completedMatches: 3, completedMaps, completedRounds: 154 }, teams: [], maps: [{ mapName: "de_ancient", played: completedMaps }], teamMaps: [] },
    selection: [], coverage: { detailedMaps, completedMaps, maps: [{ mapName: "de_ancient", completedMaps, detailedMaps }] }, options: { teams: [], maps: ["de_ancient"] },
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
});

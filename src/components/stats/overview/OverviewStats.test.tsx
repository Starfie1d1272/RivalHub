import React from "react";
import { render, screen, within } from "@testing-library/react";
import { buildTournamentAnalytics, buildTournamentPerformanceAnalytics } from "@cs2dak/tournament";
import { describe, expect, it, vi } from "vitest";
import type { TournamentStats } from "@/lib/stats/tournament-query";
import { parseStatsQuery } from "@/lib/stats/view-state";
import { OverviewStats } from "./OverviewStats";

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({ href, scroll, ...props }: { href: string; scroll?: boolean; [key: string]: unknown }) =>
      React.createElement("a", { href, "data-scroll": String(scroll), ...props }),
  };
});

describe("OverviewStats", () => {
  it("keeps canonical map exposure visible when DAK detail coverage is partial", () => {
    const labels = { teams: {}, players: {} };
    const data = {
      leaderboard: [],
      analytics: buildTournamentAnalytics([], { labels }),
      performance: buildTournamentPerformanceAnalytics([], { labels }),
      results: {
        totals: { completedMatches: 3, completedMaps: 7, completedRounds: 154 },
        teams: [],
        maps: [{ mapName: "de_ancient", played: 7 }],
        teamMaps: [],
      },
      selection: [],
      coverage: { detailedMaps: 4, completedMaps: 7, maps: [{ mapName: "de_ancient", completedMaps: 7, detailedMaps: 4 }] },
      options: { teams: [], maps: ["de_ancient"] },
    } as unknown as TournamentStats;

    render(<OverviewStats data={data} query={parseStatsQuery({}, [])} seasonSlug="major" />);
    const mapTable = screen.getAllByRole("table")[0]!;
    expect(within(mapTable).getByRole("link", { name: "Ancient" })).toHaveAttribute("data-scroll", "false");
    expect(within(mapTable).getByText("7")).toBeInTheDocument();
    expect(within(mapTable).getByText("4/7")).toBeInTheDocument();
    expect(screen.getByText("Round Profile · DAK 4/7 maps")).toBeInTheDocument();
    expect(screen.queryByText("Economy matrix")).not.toBeInTheDocument();
  });
});

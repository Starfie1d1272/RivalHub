import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { buildTournamentAnalytics, buildTournamentPerformanceAnalytics } from "@cs2dak/tournament";
import { describe, expect, it, vi } from "vitest";
import type { TournamentStats } from "@/lib/stats/tournament-query";
import { parseStatsQuery } from "@/lib/stats/view-state";
import { TeamsExplorer } from "./TeamsExplorer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", async () => {
  const React = await import("react");
  return { default: ({ href, ...props }: { href: string; [key: string]: unknown }) => React.createElement("a", { href, ...props }) };
});

describe("TeamsExplorer situations", () => {
  it("exposes 5v3 and 3v5 as sortable team comparison columns", () => {
    const labels = { teams: {}, players: {} };
    const data = {
      analytics: buildTournamentAnalytics([], { labels }),
      performance: buildTournamentPerformanceAnalytics([], { labels }),
      results: { teams: [] }, teamRatings: [], coverage: { completedMaps: 0, detailedMaps: 0 }, options: { maps: [] },
    } as unknown as TournamentStats;
    render(<TeamsExplorer data={data} query={parseStatsQuery({ tab: "teams" }, [])} seasonSlug="major" />);
    fireEvent.click(screen.getByRole("tab", { name: "Situations" }));
    expect(screen.getByRole("button", { name: /^Sort by 5v3/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Sort by 3v5/ })).toBeInTheDocument();
  });
});

import React from "react";
import { render, screen } from "@testing-library/react";
import { buildTournamentAnalytics, buildTournamentPerformanceAnalytics } from "@cs2dak/tournament";
import { expect, it, vi } from "vitest";
import { buildTournamentResults } from "@/lib/stats/results";
import { parseStatsQuery } from "@/lib/stats/view-state";
import type { TournamentStats } from "@/lib/stats/tournament-query";
import { PlayersExplorer } from "./PlayersExplorer";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/players/PlayerProfileLink", () => ({ PlayerProfileLink: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
it("filters merged user rows by their actual entries without recalculating the aggregate", () => {
  const labels = { teams: {}, players: {} };
  const data = { leaderboard: [
    { userId: "user-a", perfectName: "Alpha", teamId: null, teamIds: ["entry-a", "entry-b"], teamName: "A / B", maps: 2, rounds: 40 },
    { userId: "user-b", perfectName: "Beta", teamId: null, teamIds: ["entry-c"], teamName: "C", maps: 1, rounds: 20 },
  ], teamRatings: [], analytics: buildTournamentAnalytics([], { labels }), performance: buildTournamentPerformanceAnalytics([], { labels }),
    results: buildTournamentResults([], [], []), coverage: { detailedMaps: 2, completedMaps: 2, maps: [] }, options: { teams: [], maps: [] } } as unknown as TournamentStats;
  const query = { ...parseStatsQuery({ tab: "players" }, []), teamFilter: "entry-b" };
  render(<PlayersExplorer data={data} query={query} seasonSlug="major" />);
  expect(screen.getByText("Alpha")).toBeInTheDocument();
  expect(screen.queryByText("Beta")).not.toBeInTheDocument();
  expect(screen.getByText("2")).toBeInTheDocument();
  expect(screen.getByText("40")).toBeInTheDocument();
  expect(screen.getByText("1 player")).toBeInTheDocument();
});

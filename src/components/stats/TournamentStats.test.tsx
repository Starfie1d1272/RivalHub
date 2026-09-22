/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TournamentStats } from "@/lib/stats/tournament-query";
import { parseStatsQuery } from "@/lib/stats/query-state";

vi.mock("./StatsFilters", () => ({
  StatsFilters: () => null,
  StatsPagination: () => null,
}));
vi.mock("@/components/matches/StatsLeaderboard", () => ({
  StatsLeaderboard: () => null,
}));

import { TournamentStatsView } from "./TournamentStats";

const rate = { wins: 1, opportunities: 1, rate: 1 };

function makeData(overrides: Record<string, unknown> = {}): TournamentStats {
  return {
    leaderboard: [],
    analytics: { totals: {}, maps: [], teams: [], economyMatrix: [], weapons: [] },
    performance: { totals: {}, players: [], teams: [], maps: [], weapons: [] },
    selection: [],
    coverage: { confirmedMaps: 0, completedMaps: 0 },
    options: { teams: [], maps: [] },
    ...overrides,
  } as unknown as TournamentStats;
}

describe("TournamentStatsView", () => {
  it("hides DAK zero-model cards behind the overview availability gate", () => {
    const query = parseStatsQuery({ tab: "overview" }, []);
    render(<TournamentStatsView data={makeData()} query={query} seasonSlug="spring" stages={[]} />);

    expect(screen.getByText("当前范围暂无已确认 Demo 详细统计")).toBeInTheDocument();
    expect(screen.queryByText("Matches")).not.toBeInTheDocument();
    expect(screen.queryByText("人数优势转化")).not.toBeInTheDocument();
  });

  it("joins BP and performance into one selected-map table and one tendency drill-down", () => {
    const query = parseStatsQuery({ tab: "maps", map: "de_ancient" }, []);
    const data = makeData({
      analytics: {
        totals: {},
        maps: [{ mapName: "de_ancient", mapCount: 1, roundCount: 24, t: rate, ct: rate, pistolT: rate, pistolCt: rate }],
        teams: [],
        economyMatrix: [],
        weapons: [],
      },
      selection: [{ mapName: "de_ancient", picks: 1, bans: 2, deciders: 0, teams: [{ entryId: "team-a", name: "Alpha", picks: 1, bans: 0 }] }],
      coverage: { confirmedMaps: 1, completedMaps: 1 },
    });
    render(<TournamentStatsView data={data} query={query} seasonSlug="spring" stages={[]} />);

    expect(screen.getAllByText("Ancient").length).toBeGreaterThan(0);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Team" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader", { name: "Map" })).toHaveLength(1);
  });

  it("keeps RivalHub BP visible when DAK coverage is empty", () => {
    const query = parseStatsQuery({ tab: "maps" }, []);
    const data = makeData({
      selection: [{ mapName: "de_ancient", picks: 1, bans: 0, deciders: 0, teams: [] }],
    });
    render(<TournamentStatsView data={data} query={query} seasonSlug="spring" stages={[]} />);

    expect(screen.getByText("Ancient")).toBeInTheDocument();
    expect(screen.queryByText("武器表现")).not.toBeInTheDocument();
  });
});

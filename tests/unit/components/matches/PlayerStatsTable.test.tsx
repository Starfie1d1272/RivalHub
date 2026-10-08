/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { PlayerStatsTable } from "@/components/matches/PlayerStatsTable";
import type { SummaryPlayer } from "@/components/matches/MatchSummaryStats";

const baseProps = {
  entryAId: "ta",
  entryBId: "tb",
  teamAName: "队伍 A",
  teamBName: "队伍 B",
};

function player(overrides: Partial<SummaryPlayer> = {}): SummaryPlayer {
  return {
    userId: "u-a",
    perfectName: "选手 A",
    teamId: "ta",
    kills: 10,
    deaths: 5,
    assists: 3,
    adr: 80,
    ratingPro: 1.1,
    hsPercent: 50,
    firstKills: 2,
    multiKills: 1,
    clutches: 0,
    rws: 12,
    we: 1.5,
    mapsPlayed: 1,
    ...overrides,
  };
}

describe("PlayerStatsTable", () => {
  it("renders the empty state when no confirmed stats are available", () => {
    render(<PlayerStatsTable {...baseProps} players={[]} />);
    expect(screen.getByText("暂无玩家数据")).toBeInTheDocument();
  });

  it("keeps missing values unknown while showing real zero", () => {
    render(<PlayerStatsTable {...baseProps} players={[
      player({ perfectName: "缺失数据", kills: null, deaths: null, assists: null, adr: null, ratingPro: null, hsPercent: null, firstKills: null, multiKills: null, clutches: null, we: null }),
      player({ userId: "u-b", perfectName: "零数据", teamId: "tb", kills: 0, deaths: 0, assists: 0, adr: 0, ratingPro: 0, hsPercent: 0, firstKills: 0, multiKills: 0, clutches: 0, we: 0 }),
    ]} />);
    const missing = screen.getByRole("row", { name: /缺失数据/ });
    const zero = screen.getByRole("row", { name: /零数据/ });
    expect(within(missing).getAllByRole("cell").slice(1).every(cell => cell.textContent === "—")).toBe(true);
    expect(zero).not.toHaveTextContent("—");
    expect(zero).toHaveTextContent("0");
  });
});

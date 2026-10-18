import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildTournamentAnalytics, buildTournamentPerformanceAnalytics, type TournamentPerformancePlayerRoundFact } from "@cs2dak/tournament";
import { MapWorkspace } from "@/components/stats/maps/MapWorkspace";
import { PlayersExplorer } from "@/components/stats/players/PlayersExplorer";
import { buildTournamentResults } from "@/lib/stats/results";
import type { TournamentMapDetail, TournamentStats } from "@/lib/stats/tournament-query";
import { parseStatsQuery } from "@/lib/stats/view-state";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(cleanup);

// The shared formatter accepts any rate-shaped value. Only rendered consumer
// evidence catches a correct number paired with another metric's help/sample.
// Distinct opening, R2 and clutch samples make accidental reuse observable;
// jsdom is sufficient because neither calculation nor persistence changes here.
function performanceFixture() {
  const playerRounds: TournamentPerformancePlayerRoundFact[] = [1, 2].map((roundSeq) => ({
    roundSeq, playerEntityKey: "player", teamEntityKey: "team", side: "ct",
    teamWonRound: roundSeq === 1, kills: 0, deaths: 0, assists: 0, damage: 0,
    headshots: 0, survived: false, kast: false, tradeKills: 0, tradedDeaths: 0,
    openingDuel: "none", clutch: { opponentCount: roundSeq === 1 ? 1 : 2, won: roundSeq === 1 },
    utility: { flashesThrown: 0, enemyBlindSeconds: 0, teamBlindSeconds: 0, enemyBlindVictims: 0,
      flashAssists: 0, heThrows: 0, heDamage: 0, fireThrows: 0, fireDamage: 0,
      smokesThrown: 0, utilityKills: 0, utilityDamage: 0 },
  }));
  return buildTournamentPerformanceAnalytics([{
    semanticProfile: "fixture", analysisVersion: "fixture", mapKey: "map", matchKey: "match",
    mapName: "de_mirage", teamEntityKeys: { teamA: "team", teamB: "opponent" },
    playerRounds, objectives: [], playerWeapons: [],
  }]);
}

function mapFixture(): TournamentMapDetail {
  const analytics = buildTournamentAnalytics([]);
  analytics.maps.push({ ...analytics.totals, mapName: "de_mirage", roundCount: 20 });
  analytics.totals.round2Conversion = { wins: 3, opportunities: 4, rate: 0.75 };
  analytics.totals.round2Break = { wins: 1, opportunities: 5, rate: 0.2 };
  const performance = performanceFixture();
  performance.maps[0].opening = {
    openingRounds: 20, roundsWithOpening: 10, openingWinnerTeamRoundWins: 7, openingLoserTeamComebacks: 3,
    conversionRate: { successes: 7, attempts: 10, rate: 0.7 },
    comebackRate: { successes: 3, attempts: 10, rate: 0.3 },
  };
  return {
    map: "de_mirage", analytics, performance, selection: [], entries: [],
    results: buildTournamentResults([], [], []),
    coverage: { completedMaps: 1, detailedMaps: 1, maps: [] },
  };
}

async function expectHelp(user: ReturnType<typeof userEvent.setup>, scope: HTMLElement, name: string, meaning: RegExp) {
  const trigger = within(scope).getByRole("button", { name });
  await user.click(trigger);
  const tooltipId = trigger.getAttribute("aria-describedby");
  expect(tooltipId).toBeTruthy();
  expect(document.getElementById(tooltipId!)).toHaveTextContent(meaning);
}

function mapMetric(label: string) {
  const term = screen.getByText(label).closest("dt");
  if (!term?.parentElement) throw new Error(`Missing metric: ${label}`);
  return term.parentElement;
}

function economyMetric(label: string) {
  const heading = screen.getByRole("heading", { name: new RegExp(label) });
  return heading.closest("section")!;
}

describe("Stats metric consumer semantics", () => {
  it("keeps opening rounds and second-round opportunities distinct across map tabs", async () => {
    const user = userEvent.setup();
    render(<MapWorkspace detail={mapFixture()} seasonSlug="season" />);
    const conversion = mapMetric("Opening Conversion");
    expect(conversion).toHaveTextContent("70.0%");
    expect(conversion).toHaveTextContent("7/10 rounds");
    await expectHelp(user, conversion, "Opening Conversion 指标说明", /取得首杀.*分母为发生有效首杀对枪的回合数/);
    const comeback = mapMetric("Opening Comeback");
    expect(comeback).toHaveTextContent("30.0%");
    expect(comeback).toHaveTextContent("3/10 rounds");
    await expectHelp(user, comeback, "Opening Comeback 指标说明", /首死.*分母为发生有效首杀对枪的回合数/);

    await user.click(screen.getByRole("tab", { name: "Economy" }));
    const r2Conversion = economyMetric("R2 Conversion");
    expect(r2Conversion).toHaveTextContent("75.0%");
    expect(r2Conversion).toHaveTextContent("3/4 opportunities");
    await expectHelp(user, r2Conversion, "R2 Conversion 指标说明", /分母为赢得手枪局后的第二回合机会数/);
    const r2Break = economyMetric("R2 Break");
    expect(r2Break).toHaveTextContent("20.0%");
    expect(r2Break).toHaveTextContent("1/5 opportunities");
    await expectHelp(user, r2Break, "R2 Break 指标说明", /分母为输掉手枪局后的第二回合机会数/);
  });

  it("retains missing opening data as unavailable", () => {
    const detail = mapFixture();
    detail.performance.maps = [];
    render(<MapWorkspace detail={detail} seasonSlug="season" />);
    expect(mapMetric("Opening Conversion")).toHaveTextContent("—");
    expect(mapMetric("Opening Comeback")).toHaveTextContent("—");
  });

  it("describes 1v1 and 1v2 as scenario-specific clutch attempts", async () => {
    const user = userEvent.setup();
    // Only the explorer's public read-model fields are needed in this fixture.
    const data = {
      leaderboard: [], performance: performanceFixture(),
      coverage: { completedMaps: 1, detailedMaps: 1, maps: [] }, options: { teams: [], maps: [] },
    } as unknown as TournamentStats;
    render(<PlayersExplorer data={data} query={parseStatsQuery({}, [])} seasonSlug="season" />);
    await user.click(screen.getByRole("tab", { name: "Clutch" }));
    for (const [label, value, sample] of [["1v1%", "100.0%", "1 / 1"], ["1v2%", "0.0%", "0 / 1"]]) {
      const header = screen.getByRole("columnheader", { name: new RegExp(label) });
      await expectHelp(user, header, "1vX% 指标说明", /分母为该 1vX 场景的尝试次数/);
      const headers = within(header.closest("tr")!).getAllByRole("columnheader");
      const row = screen.getByText("player").closest("tr")!;
      const cell = within(row).getAllByRole("cell")[headers.indexOf(header)];
      expect(cell).toHaveTextContent(value);
      expect(cell).toHaveTextContent(sample);
    }
  });
});

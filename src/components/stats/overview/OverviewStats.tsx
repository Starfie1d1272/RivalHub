"use client";
import React from "react";

import Link from "next/link";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { MetricValue } from "@/components/stats/MetricValue";
import { StatsSideSplit } from "@/components/stats/StatsSideSplit";
import { StatsDataTable, type StatsDataColumn } from "@/components/stats/StatsDataTable";
import type { TournamentStats } from "@/lib/stats/tournament-query";
import { statsHref, type StatsQuery } from "@/lib/stats/view-state";
import { getDynamicRankingFloor, isRankingEligible } from "@/lib/stats/ranking";
import { displayWeaponName, statsRateDenominator, type StatsRateValue } from "@/lib/stats/presentation";
import type { StatsMetricKey } from "@/lib/stats/metrics";
import { sortStatsRows } from "@/lib/stats/sorting";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";

interface MapLandscapeRow {
  mapName: string;
  played: number;
  rounds: number;
  ct: TournamentStats["analytics"]["maps"][number]["ct"] | null;
  t: TournamentStats["analytics"]["maps"][number]["t"] | null;
  detailed: number;
  completed: number;
}

function mapLabel(mapName: string) {
  return CS2_MAP_CATALOG.find((row) => row.key === mapName)?.label ?? mapName;
}

type TeamAnalyticsRow = TournamentStats["analytics"]["teams"][number];
type EconomyMatrixRow = TournamentStats["analytics"]["economyMatrix"][number];

type SituationHighlight = {
  key: string;
  label: string;
  metric: StatsMetricKey;
  team: TeamAnalyticsRow | null;
  value: StatsRateValue | null;
};

const FULL_BUY_ORDER = ["eco", "semi", "force"] as const;

function economyBuyLabel(value: EconomyMatrixRow["lowEconomy"]): string {
  if (value === "eco") return "Eco";
  if (value === "semi") return "Semi";
  if (value === "force") return "Force";
  return value;
}

function economyVsFullRows(data: TournamentStats): EconomyMatrixRow[] {
  return FULL_BUY_ORDER.flatMap((lowEconomy) => {
    const row = data.analytics.economyMatrix.find((candidate) => candidate.lowEconomy === lowEconomy && candidate.highEconomy === "full");
    return row ? [row] : [];
  });
}

function bestTeamRate(
  teams: readonly TeamAnalyticsRow[],
  valueFor: (team: TeamAnalyticsRow) => StatsRateValue,
): { team: TeamAnalyticsRow; value: StatsRateValue } | null {
  return teams
    .map((team) => ({ team, value: valueFor(team) }))
    .filter(({ value }) => value.rate !== null && (statsRateDenominator(value) ?? 0) > 0)
    .sort((left, right) =>
      (right.value.rate ?? -1) - (left.value.rate ?? -1) ||
      (statsRateDenominator(right.value) ?? 0) - (statsRateDenominator(left.value) ?? 0) ||
      left.team.team.displayName.localeCompare(right.team.team.displayName),
    )[0] ?? null;
}

function situationHighlights(data: TournamentStats): SituationHighlight[] {
  const teams = data.analytics.teams;
  const highlight = (
    key: string,
    label: string,
    metric: StatsMetricKey,
    valueFor: (team: TeamAnalyticsRow) => StatsRateValue,
  ): SituationHighlight => {
    const best = bestTeamRate(teams, valueFor);
    return { key, label, metric, team: best?.team ?? null, value: best?.value ?? null };
  };

  return [
    highlight("round-win", "Round Win", "roundWin", (team) => ({ rate: team.roundWinRate, wins: team.roundWins, opportunities: team.rounds })),
    highlight("r2-conv", "R2 Conversion", "conversion", (team) => team.round2.conversion),
    highlight("r2-break", "R2 Break", "break", (team) => team.round2.break),
    highlight("pistol", "Pistol Win", "pistol", (team) => team.pistol),
    highlight("5v4", "5v4 Conversion", "fiveVFour", (team) => team.manAdvantage["5v4"]),
    highlight("4v5", "4v5 Comeback", "fourVFive", (team) => team.manAdvantage["4v5"]),
    highlight("eco-semi", "Eco/Semi Upset", "ecoSemi", (team) => team.ecoSemiUpset),
    highlight("5v3", "5v3 Conversion", "fiveVThree", (team) => team.manAdvantage["5v3"]),
    highlight("3v5", "3v5 Comeback", "threeVFive", (team) => team.manAdvantage["3v5"]),
  ];
}

function landscapeRows(data: TournamentStats): MapLandscapeRow[] {
  const resultByName = new Map(data.results.maps.map((row) => [row.mapName, row]));
  const analyticsByName = new Map(data.analytics.maps.map((row) => [row.mapName, row]));
  const coverageByName = new Map(data.coverage.maps.map((row) => [row.mapName, row]));
  const names = new Set([
    ...resultByName.keys(),
    ...data.selection.map((row) => row.mapName),
    ...analyticsByName.keys(),
    ...coverageByName.keys(),
  ]);
  return [...names].map((mapName) => {
    const result = resultByName.get(mapName);
    const coverage = coverageByName.get(mapName);
    return {
      mapName,
      played: result?.played ?? 0,
      rounds: result?.rounds ?? 0,
      ct: analyticsByName.get(mapName)?.ct ?? null,
      t: analyticsByName.get(mapName)?.t ?? null,
      detailed: coverage?.detailedMaps ?? 0,
      completed: coverage?.completedMaps ?? result?.played ?? 0,
    };
  });
}

function leaders(data: TournamentStats, query: StatsQuery, seasonSlug: string) {
  const ratingFloor = getDynamicRankingFloor(data.leaderboard.map((row) => row.avgRating !== null ? row.rounds : null));
  const rankedPlayers = data.leaderboard.filter((row) => row.avgRating !== null && (!ratingFloor || isRankingEligible(row.rounds, ratingFloor.floor)));
  const topPlayers = sortStatsRows(rankedPlayers, { getValue: (row) => row.avgRating, direction: "desc" }, [
    { getValue: (row) => row.perfectName, direction: "asc" },
    { getValue: (row) => row.userId, direction: "asc" },
  ]).slice(0, 5);
  const teamRatingByEntry = new Map(data.teamRatings.map((row) => [row.entryId, row.rating]));
  const teamRows = data.results.teams.map((row) => ({ ...row, rating: teamRatingByEntry.get(row.entryId) ?? null }));
  const topTeams = sortStatsRows(teamRows, { getValue: (row) => row.rating, direction: "desc" }, [
    { getValue: (row) => row.matchWins, direction: "desc" },
    { getValue: (row) => row.matchLosses, direction: "asc" },
    { getValue: (row) => row.name, direction: "asc" },
  ]).slice(0, 5);
  const topWeapons = sortStatsRows(data.performance.weapons, { getValue: (row) => row.kills, direction: "desc" }, [
    { getValue: (row) => row.weapon, direction: "asc" },
  ]).slice(0, 5);
  const playerColumns: StatsDataColumn<TournamentStats["leaderboard"][number]>[] = [
    { key: "player", label: "Player", className: "w-[40%]", render: (row) => row.userId ? <PlayerProfileLink userId={row.userId} className="font-medium">{row.perfectName}</PlayerProfileLink> : row.perfectName },
    { key: "rating", label: "Rating", metric: "rating", numeric: true, className: "w-[22%]", render: (row) => <MetricValue metric="rating" value={row.avgRating} /> },
    { key: "sample", label: "Maps / Rds", numeric: true, className: "hidden w-[26%] sm:table-cell", render: (row) => <span>{row.maps} / {row.rounds ?? "—"}</span> },
  ];
  const teamColumns: StatsDataColumn<typeof teamRows[number]>[] = [
    { key: "team", label: "Team", className: "w-[34%]", render: (row) => <Link href={`/${seasonSlug}/teams/${row.entryId}`} className="font-medium hover:text-[var(--color-accent)]">{row.name}</Link> },
    { key: "rating", metric: "rating", numeric: true, className: "w-[21%]", render: (row) => <MetricValue metric="rating" value={row.rating} /> },
    { key: "match", label: "W-L", numeric: true, className: "w-[18%]", render: (row) => `${row.matchWins}-${row.matchLosses}` },
    { key: "maps", label: "Maps", numeric: true, className: "hidden w-[15%] sm:table-cell", render: (row) => row.maps },
  ];
  const weaponColumns: StatsDataColumn<TournamentStats["performance"]["weapons"][number]>[] = [
    { key: "weapon", label: "Weapon", className: "w-[46%]", render: (row) => <span className="font-medium">{displayWeaponName(row.weapon)}</span> },
    { key: "kills", label: "Kills", numeric: true, className: "w-[18%]", render: (row) => row.kills },
    { key: "share", label: "Share", metric: "killShare", numeric: true, className: "w-[24%]", render: (row) => <MetricValue metric="killShare" value={row.killShare} sampleDisplay="hidden" /> },
  ];
  return { topPlayers, topTeams, topWeapons, playerColumns, teamColumns, weaponColumns };
}

export function OverviewStats({ data, query, seasonSlug }: { data: TournamentStats; query: StatsQuery; seasonSlug: string }) {
  const maps = landscapeRows(data);
  const { topPlayers, topTeams, topWeapons, playerColumns, teamColumns, weaponColumns } = leaders(data, query, seasonSlug);
  const partialCoverage = data.coverage.completedMaps > 0 && data.coverage.detailedMaps < data.coverage.completedMaps;
  const mapColumns: StatsDataColumn<MapLandscapeRow>[] = [
    { key: "map", label: "Map", className: "w-[24%]", render: (row) => <Link href={statsHref(seasonSlug, query, { tab: "maps", map: row.mapName })} scroll={false} className="font-medium hover:text-[var(--color-accent)]">{mapLabel(row.mapName)}</Link> },
    { key: "played", label: "Played", numeric: true, className: "w-[12%]", sortable: true, sortValue: (row) => row.played, render: (row) => row.played },
    { key: "rounds", label: "Rounds", numeric: true, className: "w-[14%]", sortable: true, sortValue: (row) => row.rounds, render: (row) => row.rounds },
    { key: "side", label: "CT / T", className: "hidden w-[34%] sm:table-cell", sortable: true, sortValue: (row) => row.ct?.rate, render: (row) => <StatsSideSplit ct={row.ct} t={row.t} compact /> },
  ];
  if (partialCoverage) mapColumns.push({ key: "coverage", label: "Coverage", numeric: true, className: "hidden w-[16%] sm:table-cell", render: (row) => `${row.detailed}/${row.completed}` });

  const economyRows = economyVsFullRows(data);
  const highlights = situationHighlights(data);
  const economyColumns: StatsDataColumn<EconomyMatrixRow>[] = [
    { key: "buy", label: "Buy", className: "w-[34%]", render: (row) => <span className="font-medium">{economyBuyLabel(row.lowEconomy)}</span> },
    { key: "rounds", label: "Rounds", numeric: true, className: "w-[24%]", sortable: true, sortValue: (row) => row.rounds, render: (row) => row.rounds },
    { key: "win", label: "Win%", metric: "ecoSemi", numeric: true, className: "w-[42%]", sortable: true, sortValue: (row) => row.lowWinRate, rankingSample: (row) => row.rounds, render: (row) => <MetricValue metric="ecoSemi" value={{ rate: row.lowWinRate, wins: row.lowEconomyWins, opportunities: row.rounds }} sampleDisplay="compact" /> },
  ];

  return (
    <div className="space-y-7">
      <section aria-label="Tournament summary" className="border-y border-[var(--color-border)] bg-[var(--color-panel-low)]">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          <div className="px-4 py-4 lg:border-r lg:border-[var(--color-border)]">
            <p className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]">Matches</p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums">{data.results.totals.completedMatches}</p>
          </div>
          <div className="px-4 py-4 lg:border-r lg:border-[var(--color-border)]">
            <p className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]">Maps</p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums">{data.results.totals.completedMaps}</p>
          </div>
          <div className="px-4 py-4 lg:border-r lg:border-[var(--color-border)]">
            <p className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]">Rounds</p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums">{data.results.totals.completedRounds}</p>
          </div>
          <div className="px-4 py-4 lg:border-r lg:border-[var(--color-border)]">
            <p className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]">Side Split</p>
            <div className="mt-2"><StatsSideSplit ct={data.analytics.totals.ct} t={data.analytics.totals.t} /></div>
          </div>
          <div className="px-4 py-4">
            <p className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]">Pistol → R2</p>
            <div className="mt-1.5 text-lg font-semibold"><MetricValue metric="conversion" value={data.analytics.totals.round2Conversion} sampleDisplay="compact" /></div>
          </div>
        </div>
      </section>

      <section aria-labelledby="maps-heading">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 id="maps-heading" className="text-base font-semibold">Maps</h2>
          <span className="text-xs text-[var(--color-fg-dim)]">{maps.length} maps</span>
        </div>
        <StatsDataTable rows={maps} columns={mapColumns} rowKey={(row) => row.mapName} initialSortKey="played" tableClassName="table-fixed" />
      </section>

      <section aria-label="Tournament leaders" className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <section className="min-w-0">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Top Players</h2>
            <Link href={statsHref(seasonSlug, query, { tab: "players" })} scroll={false} className="text-xs text-[var(--color-fg-mid)] transition-colors hover:text-[var(--color-accent)]">View all →</Link>
          </div>
          <div className="border-y border-[var(--color-border)] bg-[var(--color-panel)]">
            <StatsDataTable embedded showRank rows={topPlayers} columns={playerColumns} rowKey={(row, index) => `${row.userId ?? row.perfectName}:${row.teamId ?? ""}:${index}`} pageSize={5} tableClassName="table-fixed" emptyLabel="暂无选手统计" />
          </div>
        </section>
        <section className="min-w-0">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Top Teams</h2>
            <Link href={statsHref(seasonSlug, query, { tab: "teams" })} scroll={false} className="text-xs text-[var(--color-fg-mid)] transition-colors hover:text-[var(--color-accent)]">View all →</Link>
          </div>
          <div className="border-y border-[var(--color-border)] bg-[var(--color-panel)]">
            <StatsDataTable embedded showRank rows={topTeams} columns={teamColumns} rowKey={(row) => row.entryId} pageSize={5} tableClassName="table-fixed" emptyLabel="暂无队伍赛果" />
          </div>
        </section>
        <section className="min-w-0">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Top Weapons</h2>
            <Link href={statsHref(seasonSlug, query, { tab: "weapons" })} scroll={false} className="text-xs text-[var(--color-fg-mid)] transition-colors hover:text-[var(--color-accent)]">View all →</Link>
          </div>
          <div className="border-y border-[var(--color-border)] bg-[var(--color-panel)]">
            <StatsDataTable embedded showRank rows={topWeapons} columns={weaponColumns} rowKey={(row) => row.weapon} pageSize={5} tableClassName="table-fixed" emptyLabel="暂无武器统计" />
          </div>
        </section>
      </section>

      <section aria-labelledby="economy-conversion">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 id="economy-conversion" className="text-base font-semibold">Economy & Conversion</h2>
          {partialCoverage && <span className="text-xs text-[var(--color-fg-dim)]">Coverage {data.coverage.detailedMaps}/{data.coverage.completedMaps}</span>}
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)]">
          <section className="min-w-0">
            <div className="mb-2.5">
              <h3 className="font-semibold">Economy vs Full Buy</h3>
              <p className="mt-0.5 text-xs text-[var(--color-fg-dim)]">Eco, semi and force rounds against full buys.</p>
            </div>
            <div className="border-y border-[var(--color-border)] bg-[var(--color-panel)]">
              <StatsDataTable embedded rows={economyRows} columns={economyColumns} rowKey={(row) => row.lowEconomy} tableClassName="table-fixed" emptyLabel="暂无对 Full Buy 的经济样本" />
            </div>
          </section>

          <section className="min-w-0">
            <div className="mb-2.5">
              <h3 className="font-semibold">Situation Highlights</h3>
              <p className="mt-0.5 text-xs text-[var(--color-fg-dim)]">Best team rate in the current scope; sample is shown with every rate.</p>
            </div>
            <div className="grid gap-px border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-3">
              {highlights.map((highlight) => (
                <div key={highlight.key} className="min-w-0 bg-[var(--color-panel-low)] px-3 py-3.5">
                  <p className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]">{highlight.label}</p>
                  {highlight.team && highlight.value ? (
                    <>
                      <Link href={`/${seasonSlug}/teams/${highlight.team.team.entityKey}`} className="mt-1.5 block truncate text-sm font-medium hover:text-[var(--color-accent)]">{highlight.team.team.displayName}</Link>
                      <div className="mt-1 text-lg font-semibold"><MetricValue metric={highlight.metric} value={highlight.value} sampleDisplay="compact" /></div>
                    </>
                  ) : <p className="mt-2 text-sm text-[var(--color-fg-dim)]">—</p>}
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

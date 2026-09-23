"use client";
import React from "react";

import Link from "next/link";
import { MetricValue } from "@/components/stats/MetricValue";
import { StatsSideSplit } from "@/components/stats/StatsSideSplit";
import { StatsDataTable, type StatsDataColumn } from "@/components/stats/StatsDataTable";
import type { TournamentStats } from "@/lib/stats/tournament-query";
import { statsHref, type StatsQuery } from "@/lib/stats/view-state";
import { sortStatsRows } from "@/lib/stats/sorting";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";

interface MapLandscapeRow {
  mapName: string;
  played: number;
  rounds: number;
  picks: number | null;
  bans: number | null;
  ct: TournamentStats["analytics"]["maps"][number]["ct"] | null;
  t: TournamentStats["analytics"]["maps"][number]["t"] | null;
  detailed: number;
  completed: number;
}

function landscapeRows(data: TournamentStats): MapLandscapeRow[] {
  const resultByName = new Map(data.results.maps.map((row) => [row.mapName, row]));
  const selectionByName = new Map(data.selection.map((row) => [row.mapName, row]));
  const analyticsByName = new Map(data.analytics.maps.map((row) => [row.mapName, row]));
  const coverageByName = new Map(data.coverage.maps.map((row) => [row.mapName, row]));
  const names = new Set([...resultByName.keys(), ...selectionByName.keys(), ...analyticsByName.keys(), ...coverageByName.keys()]);
  return [...names].map((mapName) => {
    const result = resultByName.get(mapName);
    const coverage = coverageByName.get(mapName);
    return {
      mapName,
      played: result?.played ?? 0,
      rounds: result?.rounds ?? 0,
      picks: selectionByName.get(mapName)?.picks ?? null,
      bans: selectionByName.get(mapName)?.bans ?? null,
      ct: analyticsByName.get(mapName)?.ct ?? null,
      t: analyticsByName.get(mapName)?.t ?? null,
      detailed: coverage?.detailedMaps ?? 0,
      completed: coverage?.completedMaps ?? result?.played ?? 0,
    };
  });
}

function leaders(data: TournamentStats, query: StatsQuery, seasonSlug: string) {
  const topPlayers = sortStatsRows(data.leaderboard.filter((row) => row.avgRating !== null), { getValue: (row) => row.avgRating, direction: "desc" }, [
    { getValue: (row) => row.perfectName, direction: "asc" },
    { getValue: (row) => row.userId, direction: "asc" },
  ]).slice(0, 5);
  const topTeams = sortStatsRows(data.results.teams, { getValue: (row) => row.matchWins, direction: "desc" }, [
    { getValue: (row) => row.matchLosses, direction: "asc" },
    { getValue: (row) => row.mapWins - row.mapLosses, direction: "desc" },
    { getValue: (row) => row.name, direction: "asc" },
  ]).slice(0, 5);
  const playerColumns: StatsDataColumn<TournamentStats["leaderboard"][number]>[] = [
    { key: "player", label: "Player", className: "w-[52%]", render: (row) => row.userId ? <Link href={`/players/${row.userId}`} className="font-medium hover:text-[var(--color-accent)]">{row.perfectName}</Link> : row.perfectName },
    { key: "rating", label: "Rating", numeric: true, className: "w-[18%]", render: (row) => <MetricValue metric="rating" value={row.avgRating} /> },
    { key: "sample", label: "Maps / Rounds", numeric: true, className: "hidden w-[30%] sm:table-cell", render: (row) => <span>{row.maps} / {row.rounds ?? "—"}</span> },
  ];
  const teamColumns: StatsDataColumn<TournamentStats["results"]["teams"][number]>[] = [
    { key: "team", label: "Team", className: "w-[52%]", render: (row) => <Link href={statsHref(seasonSlug, query, { tab: "teams", team: row.entryId })} scroll={false} className="font-medium hover:text-[var(--color-accent)]">{row.name}</Link> },
    { key: "match", label: "Match W-L", numeric: true, className: "w-[24%]", render: (row) => `${row.matchWins}-${row.matchLosses}` },
    { key: "map", label: "Map W-L", numeric: true, className: "hidden w-[24%] sm:table-cell", render: (row) => `${row.mapWins}-${row.mapLosses}` },
  ];
  return { topPlayers, topTeams, playerColumns, teamColumns };
}

export function OverviewStats({ data, query, seasonSlug }: { data: TournamentStats; query: StatsQuery; seasonSlug: string }) {
  const maps = landscapeRows(data);
  const { topPlayers, topTeams, playerColumns, teamColumns } = leaders(data, query, seasonSlug);
  const partialCoverage = data.coverage.completedMaps > 0 && data.coverage.detailedMaps < data.coverage.completedMaps;
  const mapColumns: StatsDataColumn<MapLandscapeRow>[] = [
    { key: "map", label: "Map", className: "w-[28%]", render: (row) => <Link href={statsHref(seasonSlug, query, { tab: "maps", map: row.mapName })} scroll={false} className="font-medium hover:text-[var(--color-accent)]">{mapLabel(row.mapName)}</Link> },
    { key: "played", label: "Played", numeric: true, className: "w-[10%]", sortable: true, sortValue: (row) => row.played, render: (row) => row.played },
    { key: "rounds", label: "Rounds", numeric: true, className: "w-[11%]", sortable: true, sortValue: (row) => row.rounds, render: (row) => row.rounds },
    { key: "pick", label: "Pick", numeric: true, className: "w-[8%]", sortable: true, sortValue: (row) => row.picks, render: (row) => row.picks ?? "—" },
    { key: "ban", label: "Ban", numeric: true, className: "w-[8%]", sortable: true, sortValue: (row) => row.bans, render: (row) => row.bans ?? "—" },
    { key: "side", label: "CT / T", className: "hidden w-[35%] sm:table-cell", sortable: true, sortValue: (row) => row.ct?.rate, render: (row) => <StatsSideSplit ct={row.ct} t={row.t} compact /> },
  ];
  if (partialCoverage) mapColumns.push({ key: "coverage", label: "Coverage", numeric: true, className: "hidden sm:table-cell", render: (row) => `${row.detailed}/${row.completed}` });

  const roundProfile = [
    ["Pistol → R2", "conversion", data.analytics.totals.round2Conversion],
    ["5v4 Conversion", "fiveVFour", data.analytics.totals.manAdvantage["5v4"]],
    ["4v5 Comeback", "fourVFive", data.analytics.totals.manAdvantage["4v5"]],
    ["Eco/Semi Upset", "ecoSemi", data.analytics.totals.ecoSemiUpset],
  ] as const;

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
        <StatsDataTable rows={maps} columns={mapColumns} rowKey={(row) => row.mapName} initialSortKey="played" tableClassName="min-w-[820px] table-fixed" />
      </section>

      <section aria-label="Tournament leaders" className="grid gap-6 lg:grid-cols-2">
        <section className="min-w-0">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Top Players</h2>
            <Link href={statsHref(seasonSlug, query, { tab: "players" })} scroll={false} className="text-xs text-[var(--color-fg-mid)] transition-colors hover:text-[var(--color-accent)]">View all →</Link>
          </div>
          <div className="border-y border-[var(--color-border)] bg-[var(--color-panel)]">
            <StatsDataTable embedded showRank rows={topPlayers} columns={playerColumns} rowKey={(row, index) => `${row.userId ?? row.perfectName}:${row.teamId ?? ""}:${index}`} pageSize={5} tableClassName="min-w-[460px] table-fixed" emptyLabel="暂无选手统计" />
          </div>
        </section>
        <section className="min-w-0">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Top Teams</h2>
            <Link href={statsHref(seasonSlug, query, { tab: "teams" })} scroll={false} className="text-xs text-[var(--color-fg-mid)] transition-colors hover:text-[var(--color-accent)]">View all →</Link>
          </div>
          <div className="border-y border-[var(--color-border)] bg-[var(--color-panel)]">
            <StatsDataTable embedded showRank rows={topTeams} columns={teamColumns} rowKey={(row) => row.entryId} pageSize={5} tableClassName="min-w-[460px] table-fixed" emptyLabel="暂无队伍赛果" />
          </div>
        </section>
      </section>

      <section aria-labelledby="round-context">
        <h2 id="round-context" className="mb-3 text-base font-semibold">Round Context</h2>
        <div className="grid border-y border-[var(--color-border)] bg-[var(--color-panel-low)] sm:grid-cols-2 xl:grid-cols-4">
          {roundProfile.map(([label, metric, value], index) => (
            <div key={label} className={`px-4 py-4 ${index < roundProfile.length - 1 ? "xl:border-r xl:border-[var(--color-border)]" : ""}`}>
              <p className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]">{label}</p>
              <div className="mt-1.5 text-lg font-semibold"><MetricValue metric={metric} value={value} sampleDisplay="compact" /></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

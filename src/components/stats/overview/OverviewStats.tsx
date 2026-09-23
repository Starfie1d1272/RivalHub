"use client";
import React from "react";

import Link from "next/link";
import { Panel } from "@/components/rivalhub";
import { MetricPanel, MetricValue } from "@/components/stats/MetricValue";
import { StatsDataTable, type StatsDataColumn } from "@/components/stats/StatsDataTable";
import type { TournamentStats } from "@/lib/stats/tournament-query";
import { statsHref, type StatsQuery } from "@/lib/stats/view-state";
import { sortStatsRows } from "@/lib/stats/sorting";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";

interface MapLandscapeRow { mapName: string; played: number; picks: number | null; bans: number | null; ct: TournamentStats["analytics"]["maps"][number]["ct"] | null; t: TournamentStats["analytics"]["maps"][number]["t"] | null; detailed: number; completed: number; }
function mapLabel(mapName: string) { return CS2_MAP_CATALOG.find((row) => row.key === mapName)?.label ?? mapName; }
function landscapeRows(data: TournamentStats): MapLandscapeRow[] {
  const resultByName = new Map(data.results.maps.map((row) => [row.mapName, row]));
  const selectionByName = new Map(data.selection.map((row) => [row.mapName, row]));
  const analyticsByName = new Map(data.analytics.maps.map((row) => [row.mapName, row]));
  const coverageByName = new Map(data.coverage.maps.map((row) => [row.mapName, row]));
  const names = new Set([...resultByName.keys(), ...selectionByName.keys(), ...analyticsByName.keys(), ...coverageByName.keys()]);
  return [...names].map((mapName) => {
    const result = resultByName.get(mapName); const coverage = coverageByName.get(mapName);
    return { mapName, played: result?.played ?? 0, picks: selectionByName.get(mapName)?.picks ?? null, bans: selectionByName.get(mapName)?.bans ?? null, ct: analyticsByName.get(mapName)?.ct ?? null, t: analyticsByName.get(mapName)?.t ?? null, detailed: coverage?.detailedMaps ?? 0, completed: coverage?.completedMaps ?? result?.played ?? 0 };
  });
}
function leaders(data: TournamentStats, query: StatsQuery, seasonSlug: string) {
  const topPlayers = sortStatsRows(data.leaderboard.filter((row) => row.avgRating !== null), { getValue: (row) => row.avgRating, direction: "desc" }, [{ getValue: (row) => row.perfectName, direction: "asc" }, { getValue: (row) => row.userId, direction: "asc" }]).slice(0, 5);
  const topTeams = sortStatsRows(data.results.teams, { getValue: (row) => row.matchWins, direction: "desc" }, [{ getValue: (row) => row.matchLosses, direction: "asc" }, { getValue: (row) => row.mapWins - row.mapLosses, direction: "desc" }, { getValue: (row) => row.name, direction: "asc" }]).slice(0, 5);
  const playerColumns: StatsDataColumn<TournamentStats["leaderboard"][number]>[] = [
    { key: "player", label: "Player", render: (row) => row.userId ? <Link href={`/players/${row.userId}`} className="font-medium hover:text-[var(--color-accent)]">{row.perfectName}</Link> : row.perfectName },
    { key: "rating", label: "Rating", numeric: true, render: (row) => <MetricValue metric="rating" value={row.avgRating} /> },
    { key: "sample", label: "Maps / Rounds", numeric: true, className: "hidden sm:table-cell", render: (row) => <span>{row.maps} / {row.rounds ?? "—"}</span> },
  ];
  const teamColumns: StatsDataColumn<TournamentStats["results"]["teams"][number]>[] = [
    { key: "team", label: "Team", render: (row) => <Link href={statsHref(seasonSlug, query, { tab: "teams", team: row.entryId })} scroll={false} className="font-medium hover:text-[var(--color-accent)]">{row.name}</Link> },
    { key: "match", label: "Match W-L", numeric: true, render: (row) => `${row.matchWins}-${row.matchLosses}` },
    { key: "map", label: "Map W-L", numeric: true, className: "hidden sm:table-cell", render: (row) => `${row.mapWins}-${row.mapLosses}` },
  ];
  return { topPlayers, topTeams, playerColumns, teamColumns };
}
export function OverviewStats({ data, query, seasonSlug }: { data: TournamentStats; query: StatsQuery; seasonSlug: string }) {
  const maps = landscapeRows(data); const { topPlayers, topTeams, playerColumns, teamColumns } = leaders(data, query, seasonSlug);
  const partialCoverage = data.coverage.completedMaps > 0 && data.coverage.detailedMaps < data.coverage.completedMaps;
  const mapColumns: StatsDataColumn<MapLandscapeRow>[] = [
    { key: "map", label: "Map", render: (row) => <Link href={statsHref(seasonSlug, query, { tab: "maps", map: row.mapName })} scroll={false} className="font-medium hover:text-[var(--color-accent)]">{mapLabel(row.mapName)}</Link> },
    { key: "played", label: "Played", numeric: true, sortable: true, sortValue: (row) => row.played, render: (row) => row.played },
    { key: "pick", label: "Pick", numeric: true, sortable: true, sortValue: (row) => row.picks, render: (row) => row.picks ?? "—" },
    { key: "ban", label: "Ban", numeric: true, sortable: true, sortValue: (row) => row.bans, render: (row) => row.bans ?? "—" },
    { key: "side", label: "CT / T", className: "hidden sm:table-cell", render: (row) => <span className="inline-flex gap-3"><span>CT <MetricValue metric="roundWin" value={row.ct} sampleDisplay="hidden" /></span><span>T <MetricValue metric="roundWin" value={row.t} sampleDisplay="hidden" /></span></span> },
  ];
  if (partialCoverage) mapColumns.push({ key: "coverage", label: "Coverage", numeric: true, className: "hidden sm:table-cell", render: (row) => `${row.detailed}/${row.completed}` });
  const roundProfile = [
    ["Pistol → R2", "conversion", data.analytics.totals.round2Conversion], ["5v4 Conversion", "fiveVFour", data.analytics.totals.manAdvantage["5v4"]],
    ["4v5 Comeback", "fourVFive", data.analytics.totals.manAdvantage["4v5"]], ["Eco/Semi Upset", "ecoSemi", data.analytics.totals.ecoSemiUpset],
  ] as const;
  return <div className="space-y-6">
    <section aria-label="Tournament summary"><Panel contentClassName="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      <div><p className="text-xs text-[var(--color-fg-mid)]">Matches</p><p className="mt-1 text-xl font-semibold tabular-nums">{data.results.totals.completedMatches}</p></div>
      <div><p className="text-xs text-[var(--color-fg-mid)]">Maps</p><p className="mt-1 text-xl font-semibold tabular-nums">{data.results.totals.completedMaps}</p></div>
      <div><p className="text-xs text-[var(--color-fg-mid)]">Rounds</p><p className="mt-1 text-xl font-semibold tabular-nums">{data.results.totals.completedRounds}</p></div>
      <div><p className="text-xs text-[var(--color-fg-mid)]">Side Split</p><div className="mt-1 flex flex-wrap gap-x-3 text-sm font-semibold tabular-nums"><span>CT <MetricValue metric="roundWin" value={data.analytics.totals.ct} sampleDisplay="hidden" /></span><span>T <MetricValue metric="roundWin" value={data.analytics.totals.t} sampleDisplay="hidden" /></span></div></div>
      <div><p className="text-xs text-[var(--color-fg-mid)]">Pistol → R2</p><div className="mt-1 text-sm font-semibold"><MetricValue metric="conversion" value={data.analytics.totals.round2Conversion} sampleDisplay="compact" /></div></div>
    </Panel></section>
    <section aria-labelledby="maps-heading"><h2 id="maps-heading" className="mb-3 font-semibold">Maps</h2><StatsDataTable rows={maps} columns={mapColumns} rowKey={(row) => row.mapName} initialSortKey="played" /></section>
    <section aria-labelledby="tournament-leaders"><h2 id="tournament-leaders" className="mb-3 font-semibold">Leaders</h2><div className="grid gap-4 lg:grid-cols-2">
      <MetricPanel title="Players"><StatsDataTable embedded rows={topPlayers} columns={playerColumns} rowKey={(row, index) => `${row.userId ?? row.perfectName}:${row.teamId ?? ""}:${index}`} pageSize={5} emptyLabel="暂无选手统计" /></MetricPanel>
      <MetricPanel title="Teams"><StatsDataTable embedded rows={topTeams} columns={teamColumns} rowKey={(row) => row.entryId} pageSize={5} emptyLabel="暂无队伍赛果" /></MetricPanel>
    </div></section>
    <section aria-labelledby="round-context"><h2 id="round-context" className="mb-3 font-semibold">Round Context</h2><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {roundProfile.map(([label, metric, value]) => <MetricPanel key={label} title={label}><MetricValue metric={metric} value={value} sampleDisplay="compact" /></MetricPanel>)}
    </div></section>
  </div>;
}

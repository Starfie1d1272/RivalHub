"use client";
import React from "react";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MetricFamilyTabs } from "@/components/stats/MetricFamilyTabs";
import { StatsSideSplit } from "@/components/stats/StatsSideSplit";
import { StatsDataTable, type StatsDataColumn } from "@/components/stats/StatsDataTable";
import type { TournamentStats } from "@/lib/stats/tournament-query";
import { navigateStatsScope, statsHref, type StatsQuery } from "@/lib/stats/view-state";
import { compareStatsValues, type StatsSortDirection, type StatsSortValue } from "@/lib/stats/sorting";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";

interface MapDirectoryRow {
  mapName: string;
  played: number;
  rounds: number;
  picks: number;
  bans: number;
  deciders: number;
  detailedMaps: number;
  completedMaps: number;
  ct: TournamentStats["analytics"]["maps"][number]["ct"] | null;
  t: TournamentStats["analytics"]["maps"][number]["t"] | null;
}

interface VetoMatrixRow {
  entryId: string;
  name: string;
  vetoes: number;
  cells: Record<string, { picks: number; bans: number }>;
}

const views = [
  { key: "pool", label: "Map Pool" },
  { key: "veto", label: "Veto" },
] as const;

function mapLabel(mapName: string) {
  return CS2_MAP_CATALOG.find((map) => map.key === mapName)?.label ?? mapName;
}

function orderedMaps(maps: readonly string[]) {
  const order = new Map<string, number>(CS2_MAP_CATALOG.map((map, index) => [map.key, index]));
  return [...maps].sort((left, right) => (order.get(left) ?? 999) - (order.get(right) ?? 999) || mapLabel(left).localeCompare(mapLabel(right)));
}

function rowsFor(data: TournamentStats): MapDirectoryRow[] {
  const results = new Map(data.results.maps.map((row) => [row.mapName, row]));
  const selections = new Map(data.selection.map((row) => [row.mapName, row]));
  const analytics = new Map(data.analytics.maps.map((row) => [row.mapName, row]));
  const coverage = new Map(data.coverage.maps.map((row) => [row.mapName, row]));
  const names = new Set([...results.keys(), ...selections.keys(), ...analytics.keys(), ...coverage.keys()]);

  return [...names].map((mapName) => {
    const result = results.get(mapName);
    const selection = selections.get(mapName);
    const details = coverage.get(mapName);
    return {
      mapName,
      played: result?.played ?? 0,
      rounds: result?.rounds ?? 0,
      picks: selection?.picks ?? 0,
      bans: selection?.bans ?? 0,
      deciders: selection?.deciders ?? 0,
      detailedMaps: details?.detailedMaps ?? 0,
      completedMaps: details?.completedMaps ?? result?.played ?? 0,
      ct: analytics.get(mapName)?.ct ?? null,
      t: analytics.get(mapName)?.t ?? null,
    };
  });
}

function vetoRowsFor(data: TournamentStats, maps: readonly string[]): VetoMatrixRow[] {
  const selectionByMap = new Map(data.selection.map((row) => [row.mapName, row]));
  return data.veto.teams.map((team) => ({
    ...team,
    cells: Object.fromEntries(maps.map((mapName) => {
      const teamCell = selectionByMap.get(mapName)?.teams.find((row) => row.entryId === team.entryId);
      return [mapName, teamCell ? { picks: teamCell.picks, bans: teamCell.bans } : { picks: 0, bans: 0 }];
    })),
  }));
}

type VetoSortKey = "team" | "vetoes" | `pick:${string}` | `ban:${string}`;

function vetoSortValue(row: VetoMatrixRow, key: VetoSortKey): StatsSortValue {
  if (key === "team") return row.name;
  if (key === "vetoes") return row.vetoes;
  const [kind, mapName] = key.split(":", 2);
  const cell = row.cells[mapName!] ?? { picks: 0, bans: 0 };
  return kind === "pick" ? cell.picks : cell.bans;
}

function VetoValue({ value }: { value: number }) {
  if (value === 0) return <span className="text-[var(--color-fg-dim)]">—</span>;
  return <span className="font-medium tabular-nums text-[var(--color-fg)]">{value}</span>;
}

function VetoMatrix({
  rows,
  maps,
  seasonSlug,
  query,
}: {
  rows: readonly VetoMatrixRow[];
  maps: readonly string[];
  seasonSlug: string;
  query: StatsQuery;
}) {
  const columnCount = 2 + maps.length * 2;
  const [sortKey, setSortKey] = useState<VetoSortKey>("team");
  const [direction, setDirection] = useState<StatsSortDirection>("asc");
  const sortedRows = useMemo(
    () => [...rows].sort((left, right) => compareStatsValues(vetoSortValue(left, sortKey), vetoSortValue(right, sortKey), direction)),
    [direction, rows, sortKey],
  );

  function sortBy(key: VetoSortKey) {
    if (sortKey === key) setDirection((current) => current === "desc" ? "asc" : "desc");
    else {
      setSortKey(key);
      setDirection(key === "team" ? "asc" : "desc");
    }
  }

  function sortButton(key: VetoSortKey, label: string, align: "left" | "right" | "center" = "center") {
    const active = sortKey === key;
    const arrow = direction === "desc" ? "↓" : "↑";
    const justify = align === "left" ? "justify-start" : align === "right" ? "justify-end" : "justify-center";
    return (
      <button
        type="button"
        aria-label={active ? `${label} ${arrow}` : `Sort by ${label}`}
        onClick={() => sortBy(key)}
        className={`inline-flex w-full items-center gap-1.5 ${justify} transition-colors hover:text-[var(--color-fg)] ${active ? "text-[var(--color-fg)]" : ""}`}
      >
        <span>{label}</span>
        {active && <span aria-hidden="true" className="text-[var(--color-accent)]">{arrow}</span>}
      </button>
    );
  }

  return (
    <div className="min-w-0 overflow-hidden border border-[var(--color-border)] bg-[var(--color-panel)]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]">
            <tr className="border-b border-[var(--color-border)]">
              <th rowSpan={2} aria-sort={sortKey === "team" ? direction === "desc" ? "descending" : "ascending" : "none"} className="sticky left-0 z-30 min-w-56 bg-[var(--color-panel)] px-4 py-3 text-left align-middle">
                {sortButton("team", "Team", "left")}
              </th>
              <th rowSpan={2} aria-sort={sortKey === "vetoes" ? direction === "desc" ? "descending" : "ascending" : "none"} className="w-20 min-w-20 px-3 py-3 text-right align-middle">
                {sortButton("vetoes", "Vetoes", "right")}
              </th>
              {maps.map((mapName) => (
                <th key={mapName} colSpan={2} className="border-l border-[var(--color-border)] px-2 py-2.5 text-center">
                  <Link
                    href={statsHref(seasonSlug, query, { map: mapName })}
                    scroll={false}
                    className="font-semibold text-[var(--color-fg-mid)] transition-colors hover:text-[var(--color-accent)]"
                  >
                    {mapLabel(mapName)}
                  </Link>
                </th>
              ))}
            </tr>
            <tr className="border-b border-[var(--color-border)] bg-[var(--color-panel-low)]">
              {maps.flatMap((mapName) => {
                const pickKey = `pick:${mapName}` as VetoSortKey;
                const banKey = `ban:${mapName}` as VetoSortKey;
                return [
                  <th key={`${mapName}:pick`} aria-sort={sortKey === pickKey ? direction === "desc" ? "descending" : "ascending" : "none"} className="w-14 min-w-14 border-l border-[var(--color-border)] px-2 py-2 text-center">
                    {sortButton(pickKey, "Pick")}
                  </th>,
                  <th key={`${mapName}:ban`} aria-sort={sortKey === banKey ? direction === "desc" ? "descending" : "ascending" : "none"} className="w-14 min-w-14 px-2 py-2 text-center">
                    {sortButton(banKey, "Ban")}
                  </th>,
                ];
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {sortedRows.map((row) => (
              <tr key={row.entryId} className="group transition-colors hover:bg-[var(--color-panel-hi)]">
                <td className="sticky left-0 z-20 min-w-56 bg-[var(--color-panel)] px-4 py-3 font-medium transition-colors group-hover:bg-[var(--color-panel-hi)]">
                  <Link href={`/${seasonSlug}/teams/${row.entryId}`} className="hover:text-[var(--color-accent)]">{row.name}</Link>
                </td>
                <td className="w-20 min-w-20 px-3 py-3 text-right font-mono tabular-nums text-[var(--color-fg-mid)]">{row.vetoes}</td>
                {maps.flatMap((mapName) => {
                  const cell = row.cells[mapName] ?? { picks: 0, bans: 0 };
                  return [
                    <td key={`${mapName}:pick`} aria-label={`${mapLabel(mapName)} Pick ${cell.picks}`} className="w-14 min-w-14 border-l border-[var(--color-border)] px-2 py-3 text-center font-mono">
                      <VetoValue value={cell.picks} />
                    </td>,
                    <td key={`${mapName}:ban`} aria-label={`${mapLabel(mapName)} Ban ${cell.bans}`} className="w-14 min-w-14 px-2 py-3 text-center font-mono">
                      <VetoValue value={cell.bans} />
                    </td>,
                  ];
                })}
              </tr>
            ))}
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={columnCount} className="px-4 py-8 text-center text-[var(--color-fg-mid)]">当前范围暂无匹配队伍或 BP 数据</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function MapsExplorer({ data, query, seasonSlug }: { data: TournamentStats; query: StatsQuery; seasonSlug: string }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const rows = rowsFor(data);
  const mapNames = useMemo(() => orderedMaps(data.options.maps), [data.options.maps]);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const vetoRows = useMemo(
    () => vetoRowsFor(data, mapNames).filter((row) => row.name.toLocaleLowerCase().includes(normalizedSearch)),
    [data, mapNames, normalizedSearch],
  );
  const partialCoverage = data.coverage.completedMaps > 0 && data.coverage.detailedMaps < data.coverage.completedMaps;
  const poolColumns: StatsDataColumn<MapDirectoryRow>[] = [
    { key: "map", label: "Map", className: "w-[28%]", render: (row) => <Link href={statsHref(seasonSlug, query, { map: row.mapName })} scroll={false} className="font-medium hover:text-[var(--color-accent)]">{mapLabel(row.mapName)}</Link> },
    { key: "played", label: "Played", numeric: true, className: "w-[10%]", sortable: true, sortValue: (row) => row.played, render: (row) => row.played },
    { key: "rounds", label: "Rounds", numeric: true, className: "w-[11%]", sortable: true, sortValue: (row) => row.rounds, render: (row) => row.rounds },
    { key: "pick", label: "Picks", numeric: true, className: "hidden w-[8%] sm:table-cell", sortable: true, sortValue: (row) => row.picks, render: (row) => row.picks },
    { key: "ban", label: "Bans", numeric: true, className: "hidden w-[8%] sm:table-cell", sortable: true, sortValue: (row) => row.bans, render: (row) => row.bans },
    { key: "decider", label: "Deciders", numeric: true, className: "hidden w-[9%] lg:table-cell", sortable: true, sortValue: (row) => row.deciders, render: (row) => row.deciders },
    ...(partialCoverage ? [{
      key: "coverage",
      label: "Coverage",
      numeric: true,
      className: "hidden w-[10%] lg:table-cell",
      sortable: true,
      sortValue: (row: MapDirectoryRow) => row.detailedMaps,
      render: (row: MapDirectoryRow) => `${row.detailedMaps}/${row.completedMaps}`,
    } satisfies StatsDataColumn<MapDirectoryRow>] : []),
    { key: "ctT", label: "CT / T", className: "hidden w-[26%] sm:table-cell", sortable: true, sortValue: (row) => row.ct?.rate, render: (row) => <StatsSideSplit ct={row.ct} t={row.t} compact /> },
  ];

  return (
    <section className="space-y-4">
      <MetricFamilyTabs
        label="Map stats"
        value={query.mapsView}
        options={views}
        onChange={(value) => navigateStatsScope(router, seasonSlug, query, { mapsView: value })}
      />

      {query.mapsView === "pool" ? (
        <>
          <div className="flex items-center justify-end gap-3 text-xs text-[var(--color-fg-dim)]">
            {partialCoverage && <span>Coverage {data.coverage.detailedMaps}/{data.coverage.completedMaps}</span>}
            <span>{rows.length} maps</span>
          </div>
          <StatsDataTable
            rows={rows}
            columns={poolColumns}
            rowKey={(row) => row.mapName}
            initialSortKey="played"
            tableClassName="min-w-[860px] table-fixed"
            emptyLabel="暂无地图赛果或 BP 数据"
          />
        </>
      ) : (
        <>
          <div className="flex min-w-0 flex-wrap items-end gap-3">
            <label className="grid w-full gap-1 sm:w-64">
              <span className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]">Search team</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" className="min-h-8 border border-[var(--color-border)] bg-[var(--color-panel-low)] px-2.5 py-1.5 text-sm" placeholder="Team" />
            </label>
            <div className="ml-auto flex items-center gap-3 pb-1 text-xs text-[var(--color-fg-dim)]">
              {data.veto.sample.missingMatches > 0 && <span>BP {data.veto.sample.recordedMatches}/{data.veto.sample.applicableMatches} matches</span>}
              <span>{vetoRows.length} teams · {mapNames.length} maps</span>
            </div>
          </div>
          <VetoMatrix rows={vetoRows} maps={mapNames} seasonSlug={seasonSlug} query={query} />
        </>
      )}
    </section>
  );
}

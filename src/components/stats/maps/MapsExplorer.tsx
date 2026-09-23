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
  const vetoColumns: StatsDataColumn<VetoMatrixRow>[] = [
    { key: "team", label: "Team", className: "min-w-52", sortable: true, sortValue: (row) => row.name, render: (row) => <Link href={`/${seasonSlug}/teams/${row.entryId}`} className="font-medium hover:text-[var(--color-accent)]">{row.name}</Link> },
    { key: "vetoes", label: "Vetoes", numeric: true, className: "w-20", sortable: true, sortValue: (row) => row.vetoes, render: (row) => row.vetoes },
    ...mapNames.map((mapName) => ({
      key: mapName,
      label: mapLabel(mapName),
      numeric: true,
      className: "min-w-28",
      sortable: true,
      sortValue: (row: VetoMatrixRow) => row.cells[mapName]!.picks + row.cells[mapName]!.bans,
      render: (row: VetoMatrixRow) => {
        const cell = row.cells[mapName]!;
        if (cell.picks === 0 && cell.bans === 0) return <span className="text-[var(--color-fg-dim)]">—</span>;
        return <span className="tabular-nums">{cell.picks > 0 ? `P${cell.picks}` : "—"} · {cell.bans > 0 ? `B${cell.bans}` : "—"}</span>;
      },
    } satisfies StatsDataColumn<VetoMatrixRow>)),
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
            <label className="grid min-w-56 flex-1 gap-1 sm:max-w-sm">
              <span className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]">Search team</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" className="min-h-8 border border-[var(--color-border)] bg-[var(--color-panel-low)] px-2.5 py-1.5 text-sm" placeholder="Team" />
            </label>
            <div className="ml-auto flex items-center gap-3 pb-1 text-xs text-[var(--color-fg-dim)]">
              {data.veto.sample.missingMatches > 0 && <span>BP {data.veto.sample.recordedMatches}/{data.veto.sample.applicableMatches} matches</span>}
              <span>{vetoRows.length} teams · {mapNames.length} maps</span>
            </div>
          </div>
          <StatsDataTable
            rows={vetoRows}
            columns={vetoColumns}
            rowKey={(row) => row.entryId}
            initialSortKey="team"
            initialDirection="asc"
            pageSize={50}
            tableClassName="min-w-max"
            emptyLabel="当前范围暂无 BP 数据"
          />
        </>
      )}
    </section>
  );
}

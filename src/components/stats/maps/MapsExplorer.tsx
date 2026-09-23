"use client";
import React from "react";

import Link from "next/link";
import { StatsSideSplit } from "@/components/stats/StatsSideSplit";
import { StatsDataTable, type StatsDataColumn } from "@/components/stats/StatsDataTable";
import type { TournamentStats } from "@/lib/stats/tournament-query";
import { statsHref, type StatsQuery } from "@/lib/stats/view-state";
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

function mapLabel(mapName: string) {
  return CS2_MAP_CATALOG.find((map) => map.key === mapName)?.label ?? mapName;
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

export function MapsExplorer({ data, query, seasonSlug }: { data: TournamentStats; query: StatsQuery; seasonSlug: string }) {
  const rows = rowsFor(data);
  const partialCoverage = data.coverage.completedMaps > 0 && data.coverage.detailedMaps < data.coverage.completedMaps;
  const columns: StatsDataColumn<MapDirectoryRow>[] = [
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
    <section className="space-y-3">
      <div className="flex items-center justify-end gap-3 text-xs text-[var(--color-fg-dim)]">
        {partialCoverage && <span>Coverage {data.coverage.detailedMaps}/{data.coverage.completedMaps}</span>}
        <span>{rows.length} maps</span>
      </div>
      <StatsDataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.mapName}
        initialSortKey="played"
        tableClassName="min-w-[860px] table-fixed"
        emptyLabel="暂无地图赛果或 BP 数据"
      />
    </section>
  );
}

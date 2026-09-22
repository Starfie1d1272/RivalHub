"use client";
import React from "react";

import Link from "next/link";
import { MetricValue } from "@/components/stats/MetricValue";
import { StatsDataTable, type StatsDataColumn } from "@/components/stats/StatsDataTable";
import type { TournamentStats } from "@/lib/stats/tournament-query";
import { statsHref, type StatsQuery } from "@/lib/stats/view-state";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";

interface MapDirectoryRow {
  mapName: string;
  played: number;
  picks: number;
  bans: number;
  deciders: number;
  detailedMaps: number;
  completedMaps: number;
  ct: TournamentStats["analytics"]["maps"][number]["ct"] | null;
  t: TournamentStats["analytics"]["maps"][number]["t"] | null;
}

function mapLabel(mapName: string) { return CS2_MAP_CATALOG.find((map) => map.key === mapName)?.label ?? mapName; }

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
  const columns: StatsDataColumn<MapDirectoryRow>[] = [
    { key: "map", label: "Map", render: (row) => <Link href={statsHref(seasonSlug, query, { map: row.mapName })} scroll={false} className="font-medium hover:text-[var(--color-accent)]">{mapLabel(row.mapName)}</Link> },
    { key: "played", label: "Played", numeric: true, sortable: true, sortValue: (row) => row.played, render: (row) => row.played },
    { key: "pickBan", label: "Pick / Ban", numeric: true, className: "hidden sm:table-cell", render: (row) => `${row.picks} / ${row.bans}` },
    { key: "pickBanCompact", label: "P / B", numeric: true, className: "sm:hidden", render: (row) => `${row.picks}/${row.bans}` },
    { key: "decider", label: "Decider", numeric: true, className: "hidden sm:table-cell", render: (row) => row.deciders },
    { key: "detail", label: "Detail", numeric: true, className: "hidden sm:table-cell", sortable: true, sortValue: (row) => row.detailedMaps, render: (row) => `${row.detailedMaps}/${row.completedMaps}` },
    { key: "ctT", label: "CT% / T%", numeric: true, sortable: true, sortValue: (row) => row.ct?.rate, render: (row) => <span className="inline-flex gap-2"><MetricValue metric="roundWin" value={row.ct} sampleLabel="CT rounds" /><MetricValue metric="roundWin" value={row.t} sampleLabel="T rounds" /></span> },
  ];
  return (
    <section className="space-y-4">
      <p className="text-sm text-[var(--color-fg-mid)]">Played 来自已完成地图；Detail 与 CT/T 只基于已确认 DAK。</p>
      <StatsDataTable rows={rowsFor(data)} columns={columns} rowKey={(row) => row.mapName} initialSortKey="played" emptyLabel="暂无地图赛果或 BP 数据" />
    </section>
  );
}

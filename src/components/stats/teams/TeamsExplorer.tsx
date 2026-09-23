"use client";
import React from "react";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MetricFamilyTabs } from "@/components/stats/MetricFamilyTabs";
import { MetricValue } from "@/components/stats/MetricValue";
import { StatsDataTable, type StatsDataColumn } from "@/components/stats/StatsDataTable";
import type { TournamentStats } from "@/lib/stats/tournament-query";
import { statsHref, type StatsQuery } from "@/lib/stats/view-state";
import { navigateStatsScope } from "@/lib/stats/view-state";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";

type Family = "results" | "rounds" | "conversion" | "teamplay";
const families = [
  { key: "results", label: "Results" },
  { key: "rounds", label: "Rounds" },
  { key: "conversion", label: "Conversion" },
  { key: "teamplay", label: "Teamplay" },
] as const;

interface TeamDirectoryRow {
  entryId: string;
  name: string;
  matches: number;
  matchWins: number;
  matchLosses: number;
  maps: number;
  mapWins: number;
  mapLosses: number;
  analytics: TournamentStats["analytics"]["teams"][number] | null;
  performance: TournamentStats["performance"]["teams"][number] | null;
}

function rowsFor(data: TournamentStats): TeamDirectoryRow[] {
  const analytics = new Map(data.analytics.teams.map((row) => [row.team.entityKey, row]));
  const performance = new Map(data.performance.teams.map((row) => [row.team.entityKey, row]));
  return data.results.teams.map((row) => ({
    ...row,
    analytics: analytics.get(row.entryId) ?? null,
    performance: performance.get(row.entryId) ?? null,
  }));
}

function teamColumns(family: Family, seasonSlug: string, query: StatsQuery): StatsDataColumn<TeamDirectoryRow>[] {
  const teamColumn: StatsDataColumn<TeamDirectoryRow> = {
    key: "team",
    label: "Team",
    className: "w-[28%]",
    sortable: true,
    sortValue: (row) => row.name,
    render: (row) => <Link href={statsHref(seasonSlug, query, { team: row.entryId })} scroll={false} className="font-medium hover:text-[var(--color-accent)]">{row.name}</Link>,
  };
  const detailSample: StatsDataColumn<TeamDirectoryRow>[] = [
    { key: "detailMaps", label: "Maps", numeric: true, className: "w-[9%]", sortable: true, sortValue: (row) => row.analytics?.mapCount ?? null, render: (row) => row.analytics?.mapCount ?? 0 },
    { key: "rounds", label: "Rounds", numeric: true, className: "hidden w-[10%] sm:table-cell", sortable: true, sortValue: (row) => row.analytics?.rounds ?? null, render: (row) => row.analytics?.rounds ?? "—" },
  ];

  if (family === "results") return [
    teamColumn,
    { key: "match", label: "Match W-L", numeric: true, sortable: true, sortValue: (row) => row.matchWins, render: (row) => `${row.matchWins}-${row.matchLosses}` },
    { key: "map", label: "Map W-L", numeric: true, className: "hidden sm:table-cell", sortable: true, sortValue: (row) => row.mapWins - row.mapLosses, render: (row) => `${row.mapWins}-${row.mapLosses}` },
    { key: "maps", label: "Maps", numeric: true, sortable: true, sortValue: (row) => row.maps, render: (row) => row.maps },
  ];

  if (family === "rounds") return [
    teamColumn,
    ...detailSample,
    { key: "rw", label: "RW%", numeric: true, sortable: true, sortValue: (row) => row.analytics?.roundWinRate, render: (row) => row.analytics ? <MetricValue metric="roundWin" value={{ wins: row.analytics.roundWins, opportunities: row.analytics.rounds, rate: row.analytics.roundWinRate }} sampleDisplay="hidden" /> : "—" },
    { key: "t", label: "T%", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.analytics?.t.rate, render: (row) => row.analytics ? <MetricValue metric="roundWin" value={row.analytics.t} sampleDisplay="hidden" /> : "—" },
    { key: "ct", label: "CT%", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.analytics?.ct.rate, render: (row) => row.analytics ? <MetricValue metric="roundWin" value={row.analytics.ct} sampleDisplay="hidden" /> : "—" },
    { key: "pistol", label: "Pistol%", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.analytics?.pistol.rate, render: (row) => row.analytics ? <MetricValue metric="pistol" value={row.analytics.pistol} sampleDisplay="compact" /> : "—" },
  ];

  if (family === "conversion") return [
    teamColumn,
    ...detailSample,
    { key: "r2", label: "R2 Conv", numeric: true, sortable: true, sortValue: (row) => row.analytics?.round2.conversion.rate, render: (row) => row.analytics ? <MetricValue metric="conversion" value={row.analytics.round2.conversion} sampleDisplay="compact" /> : "—" },
    { key: "break", label: "R2 Break", numeric: true, className: "hidden sm:table-cell", sortable: true, sortValue: (row) => row.analytics?.round2.break.rate, render: (row) => row.analytics ? <MetricValue metric="break" value={row.analytics.round2.break} sampleDisplay="compact" /> : "—" },
    { key: "fiveVFour", label: "5v4", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.analytics?.manAdvantage["5v4"].rate, render: (row) => row.analytics ? <MetricValue metric="fiveVFour" value={row.analytics.manAdvantage["5v4"]} sampleDisplay="compact" /> : "—" },
    { key: "fourVFive", label: "4v5", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.analytics?.manAdvantage["4v5"].rate, render: (row) => row.analytics ? <MetricValue metric="fourVFive" value={row.analytics.manAdvantage["4v5"]} sampleDisplay="compact" /> : "—" },
    { key: "eco", label: "Eco/Semi", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.analytics?.ecoSemiUpset.rate, render: (row) => row.analytics ? <MetricValue metric="ecoSemi" value={row.analytics.ecoSemiUpset} sampleDisplay="compact" /> : "—" },
  ];

  return [
    teamColumn,
    ...detailSample,
    { key: "opening", label: "Opening%", numeric: true, sortable: true, sortValue: (row) => row.performance?.slices.overall.opening.successRate.rate, render: (row) => row.performance ? <MetricValue metric="openingWin" value={row.performance.slices.overall.opening.successRate} sampleDisplay="compact" /> : "—" },
    { key: "trade", label: "Trade/R", numeric: true, className: "hidden sm:table-cell", sortable: true, sortValue: (row) => row.performance?.slices.overall.trade.tradeKillsPerRound.rate, render: (row) => row.performance ? <MetricValue metric="trade" value={row.performance.slices.overall.trade.tradeKillsPerRound} sampleDisplay="hidden" /> : "—" },
    { key: "fa", label: "FA/R", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.performance?.slices.overall.utility.flashAssistsPerRound.rate, render: (row) => row.performance ? <MetricValue metric="flashAssist" value={row.performance.slices.overall.utility.flashAssistsPerRound} sampleDisplay="hidden" /> : "—" },
    { key: "util", label: "Util/R", numeric: true, className: "hidden lg:table-cell", sortable: true, sortValue: (row) => row.performance?.slices.overall.utility.utilityDamagePerRound.rate, render: (row) => row.performance ? <MetricValue metric="utility" value={row.performance.slices.overall.utility.utilityDamagePerRound} sampleDisplay="hidden" /> : "—" },
  ];
}

export function TeamsExplorer({ data, query, seasonSlug }: { data: TournamentStats; query: StatsQuery; seasonSlug: string }) {
  const router = useRouter();
  const [family, setFamily] = useState<Family>("results");
  const rows = useMemo(() => rowsFor(data), [data]);
  const partialCoverage = family !== "results" && data.coverage.completedMaps > 0 && data.coverage.detailedMaps < data.coverage.completedMaps;

  return (
    <section className="space-y-4">
      <MetricFamilyTabs label="Team metrics" value={family} options={families} onChange={setFamily} />

      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <label className="grid gap-1">
          <span className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]">Map</span>
          <select value={query.mapFilter} onChange={(event) => navigateStatsScope(router, seasonSlug, query, { mapFilter: event.target.value })} className="min-h-8 min-w-40 border border-[var(--color-border)] bg-[var(--color-panel-low)] px-2.5 py-1.5 text-sm">
            <option value="">All maps</option>
            {data.options.maps.map((map) => <option key={map} value={map}>{CS2_MAP_CATALOG.find((row) => row.key === map)?.label ?? map}</option>)}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-3 pb-1 text-xs text-[var(--color-fg-dim)]">
          {partialCoverage && <span>Coverage {data.coverage.detailedMaps}/{data.coverage.completedMaps}</span>}
          <span>{rows.length} teams</span>
        </div>
      </div>

      <StatsDataTable
        key={family}
        rows={rows}
        columns={teamColumns(family, seasonSlug, query)}
        rowKey={(row) => row.entryId}
        initialSortKey={family === "results" ? "match" : family === "rounds" ? "rw" : family === "conversion" ? "r2" : "opening"}
        tableClassName={family === "results" ? "min-w-[700px] table-fixed" : "min-w-[940px] table-fixed"}
        emptyLabel="当前地图范围没有已完成赛果"
      />
    </section>
  );
}

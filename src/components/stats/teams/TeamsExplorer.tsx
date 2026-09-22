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
  return data.results.teams.map((row) => ({ ...row, analytics: analytics.get(row.entryId) ?? null, performance: performance.get(row.entryId) ?? null }));
}

function teamColumns(family: Family, seasonSlug: string, query: StatsQuery): StatsDataColumn<TeamDirectoryRow>[] {
  const teamColumn: StatsDataColumn<TeamDirectoryRow> = {
    key: "team", label: "Team", sortable: true, sortValue: (row) => row.name,
    render: (row) => <Link href={statsHref(seasonSlug, query, { team: row.entryId })} scroll={false} className="font-medium hover:text-[var(--color-accent)]">{row.name}</Link>,
  };
  const dAKSample: StatsDataColumn<TeamDirectoryRow>[] = [
    { key: "dakMaps", label: "DAK Maps", numeric: true, sortable: true, sortValue: (row) => row.analytics?.mapCount ?? null, render: (row) => row.analytics?.mapCount ?? 0 },
    { key: "rounds", label: "Rounds", numeric: true, className: "hidden sm:table-cell", sortable: true, sortValue: (row) => row.analytics?.rounds ?? null, render: (row) => row.analytics?.rounds ?? "—" },
  ];
  if (family === "results") return [
    teamColumn,
    { key: "match", label: "Match W-L", numeric: true, sortable: true, sortValue: (row) => row.matchWins, render: (row) => `${row.matchWins}-${row.matchLosses}` },
    { key: "map", label: "Map W-L", numeric: true, className: "hidden sm:table-cell", sortable: true, sortValue: (row) => row.mapWins - row.mapLosses, render: (row) => `${row.mapWins}-${row.mapLosses}` },
    { key: "maps", label: "Maps", numeric: true, sortable: true, sortValue: (row) => row.maps, render: (row) => row.maps },
  ];
  if (family === "rounds") return [teamColumn, ...dAKSample,
    { key: "rw", label: "RW%", numeric: true, sortable: true, sortValue: (row) => row.analytics?.roundWinRate, render: (row) => row.analytics ? <MetricValue metric="roundWin" value={{ wins: row.analytics.roundWins, opportunities: row.analytics.rounds, rate: row.analytics.roundWinRate }} /> : "—" },
    { key: "t", label: "T%", numeric: true, className: "hidden lg:table-cell", render: (row) => row.analytics ? <MetricValue metric="roundWin" value={row.analytics.t} /> : "—" },
    { key: "ct", label: "CT%", numeric: true, className: "hidden lg:table-cell", render: (row) => row.analytics ? <MetricValue metric="roundWin" value={row.analytics.ct} /> : "—" },
    { key: "pistol", label: "Pistol%", numeric: true, className: "hidden lg:table-cell", render: (row) => row.analytics ? <MetricValue metric="pistol" value={row.analytics.pistol} /> : "—" },
  ];
  if (family === "conversion") return [teamColumn, ...dAKSample,
    { key: "r2", label: "R2 Conv", numeric: true, sortable: true, sortValue: (row) => row.analytics?.round2.conversion.rate, render: (row) => row.analytics ? <MetricValue metric="conversion" value={row.analytics.round2.conversion} /> : "—" },
    { key: "break", label: "R2 Break", numeric: true, className: "hidden sm:table-cell", render: (row) => row.analytics ? <MetricValue metric="break" value={row.analytics.round2.break} /> : "—" },
    { key: "fiveVFour", label: "5v4", numeric: true, className: "hidden lg:table-cell", render: (row) => row.analytics ? <MetricValue metric="fiveVFour" value={row.analytics.manAdvantage["5v4"]} /> : "—" },
    { key: "fourVFive", label: "4v5", numeric: true, className: "hidden lg:table-cell", render: (row) => row.analytics ? <MetricValue metric="fourVFive" value={row.analytics.manAdvantage["4v5"]} /> : "—" },
    { key: "eco", label: "Eco/Semi", numeric: true, className: "hidden lg:table-cell", render: (row) => row.analytics ? <MetricValue metric="ecoSemi" value={row.analytics.ecoSemiUpset} /> : "—" },
  ];
  return [teamColumn, ...dAKSample,
    { key: "opening", label: "Opening%", numeric: true, sortable: true, sortValue: (row) => row.performance?.slices.overall.opening.successRate.rate, render: (row) => row.performance ? <MetricValue metric="openingWin" value={row.performance.slices.overall.opening.successRate} /> : "—" },
    { key: "trade", label: "Trade/R", numeric: true, className: "hidden sm:table-cell", render: (row) => row.performance ? <MetricValue metric="trade" value={row.performance.slices.overall.trade.tradeKillsPerRound} /> : "—" },
    { key: "fa", label: "FA/R", numeric: true, className: "hidden lg:table-cell", render: (row) => row.performance ? <MetricValue metric="flashAssist" value={row.performance.slices.overall.utility.flashAssistsPerRound} /> : "—" },
    { key: "util", label: "Util/R", numeric: true, className: "hidden lg:table-cell", render: (row) => row.performance ? <MetricValue metric="utility" value={row.performance.slices.overall.utility.utilityDamagePerRound} /> : "—" },
  ];
}

export function TeamsExplorer({ data, query, seasonSlug }: { data: TournamentStats; query: StatsQuery; seasonSlug: string }) {
  const router = useRouter();
  const [family, setFamily] = useState<Family>("results");
  const rows = useMemo(() => rowsFor(data), [data]);
  return (
    <section className="space-y-4">
      <div className="flex min-w-0 flex-wrap items-end gap-3 rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
        <label className="grid gap-1 text-sm">地图
          <select value={query.mapFilter} onChange={(event) => navigateStatsScope(router, seasonSlug, query, { mapFilter: event.target.value })} className="min-h-10 min-w-40 rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)] px-3">
            <option value="">全部地图</option>{data.options.maps.map((map) => <option key={map} value={map}>{map.replace("de_", "").replaceAll("_", " ")}</option>)}
          </select>
        </label>
      </div>
      <MetricFamilyTabs label="Team metric family" value={family} options={families} onChange={setFamily} />
      <p className="text-xs text-[var(--color-fg-mid)]">{family === "results" ? "Tournament results sample" : `DAK sample · ${data.coverage.detailedMaps}/${data.coverage.completedMaps} maps`}</p>
      <StatsDataTable key={family} rows={rows} columns={teamColumns(family, seasonSlug, query)} rowKey={(row) => row.entryId} initialSortKey={family === "results" ? "match" : family === "rounds" ? "rw" : family === "conversion" ? "r2" : "opening"} emptyLabel="当前地图范围没有已完成赛果" />
    </section>
  );
}

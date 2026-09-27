"use client";
import React from "react";

import { useRouter } from "next/navigation";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { MetricValue } from "@/components/stats/MetricValue";
import { StatsDataTable, type StatsDataColumn } from "@/components/stats/StatsDataTable";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";
import { displayWeaponName, statsRateDenominator } from "@/lib/stats/presentation";
import type { TournamentStats } from "@/lib/stats/tournament-query";
import { navigateStatsScope, type StatsQuery } from "@/lib/stats/view-state";

type WeaponRow = TournamentStats["performance"]["weapons"][number];

function mapLabel(mapName: string) {
  return CS2_MAP_CATALOG.find((map) => map.key === mapName)?.label ?? mapName;
}

export function WeaponsExplorer({ data, query, seasonSlug }: { data: TournamentStats; query: StatsQuery; seasonSlug: string }) {
  const router = useRouter();
  const rows = data.performance.weapons;
  const partialCoverage = data.coverage.completedMaps > 0 && data.coverage.detailedMaps < data.coverage.completedMaps;
  const hasFilters = Boolean(query.mapFilter || query.teamFilter);
  const columns: StatsDataColumn<WeaponRow>[] = [
    { key: "weapon", label: "Weapon", className: "w-[24%]", render: (row) => <span className="font-medium">{displayWeaponName(row.weapon)}</span> },
    { key: "kills", label: "Kills", numeric: true, sortable: true, sortValue: (row) => row.kills, render: (row) => row.kills },
    { key: "share", label: "Kill Share", metric: "killShare", numeric: true, sortable: true, sortValue: (row) => row.killShare.rate, rankingSample: (row) => statsRateDenominator(row.killShare), render: (row) => <MetricValue metric="killShare" value={row.killShare} sampleDisplay="hidden" /> },
    { key: "perRound", metric: "killsPerRound", numeric: true, sortable: true, sortValue: (row) => row.killsPerRound.rate, rankingSample: (row) => statsRateDenominator(row.killsPerRound), render: (row) => <MetricValue metric="killsPerRound" value={row.killsPerRound} sampleDisplay="hidden" /> },
    { key: "hs", metric: "headshot", numeric: true, className: "hidden sm:table-cell", sortable: true, sortValue: (row) => row.headshotRate.rate, rankingSample: (row) => statsRateDenominator(row.headshotRate), render: (row) => <MetricValue metric="headshot" value={row.headshotRate} sampleDisplay="compact" /> },
    { key: "top", label: "Top Player", className: "hidden lg:table-cell", render: (row) => row.topPlayer ? <span className="inline-flex items-baseline gap-1.5"><PlayerProfileLink userId={row.topPlayer.entityKey} className="font-medium">{row.topPlayer.displayName}</PlayerProfileLink><span className="text-xs tabular-nums text-[var(--color-fg-dim)]">{row.topPlayer.kills}</span></span> : "—" },
  ];

  function clearFilters() {
    if (hasFilters) navigateStatsScope(router, seasonSlug, query, { mapFilter: "", teamFilter: "" });
  }

  return (
    <section className="space-y-4">
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <label className="grid gap-1">
          <span className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]">Map</span>
          <select value={query.mapFilter} onChange={(event) => navigateStatsScope(router, seasonSlug, query, { mapFilter: event.target.value })} className="min-h-8 min-w-36 border border-[var(--color-border)] bg-[var(--color-panel-low)] px-2.5 py-1.5 text-sm">
            <option value="">All maps</option>
            {data.options.maps.map((map) => <option key={map} value={map}>{mapLabel(map)}</option>)}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]">Team</span>
          <select value={query.teamFilter} onChange={(event) => navigateStatsScope(router, seasonSlug, query, { teamFilter: event.target.value })} className="min-h-8 min-w-40 border border-[var(--color-border)] bg-[var(--color-panel-low)] px-2.5 py-1.5 text-sm">
            <option value="">All teams</option>
            {data.options.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-3 pb-1 text-xs text-[var(--color-fg-dim)]">
          {partialCoverage && <span>Coverage {data.coverage.detailedMaps}/{data.coverage.completedMaps}</span>}
          <span>{rows.length} weapons</span>
          {hasFilters && <button type="button" onClick={clearFilters} className="text-[var(--color-fg-mid)] transition-colors hover:text-[var(--color-accent)]">Clear filters</button>}
        </div>
      </div>
      <StatsDataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.weapon}
        initialSortKey="kills"
        tableClassName="min-w-[820px] table-fixed"
        emptyLabel="当前范围暂无武器统计"
      />
    </section>
  );
}

"use client";
import React from "react";

import { useRouter } from "next/navigation";
import type { StatsQuery } from "@/lib/stats/view-state";
import { navigateStatsScope } from "@/lib/stats/view-state";

export function StatsScopeBar({ query, seasonSlug, stages, maps = [] }: { query: StatsQuery; seasonSlug: string; stages: { key: string; name: string }[]; maps?: string[] }) {
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-3">
      {stages.length > 0 && <label className="flex shrink-0 items-center gap-2 text-sm text-[var(--color-fg-mid)]">
        <span>Stage</span>
        <select
          value={query.stage}
          onChange={(event) => navigateStatsScope(router, seasonSlug, query, { stage: event.target.value })}
          className="min-h-8 min-w-32 border border-[var(--color-border)] bg-[var(--color-panel-low)] px-2.5 py-1 text-sm text-[var(--color-fg)] transition-colors hover:border-[var(--color-border-hi)]"
        >
          <option value="">All stages</option>
          {stages.map((stage) => <option key={stage.key} value={stage.key}>{stage.name}</option>)}
        </select>
      </label>}
      <label className="flex shrink-0 items-center gap-2 text-sm text-[var(--color-fg-mid)]">
        <span>赛制</span>
        <select
          value={query.format}
          onChange={(event) => navigateStatsScope(router, seasonSlug, query, { format: event.target.value as StatsQuery["format"] })}
          className="min-h-8 min-w-28 border border-[var(--color-border)] bg-[var(--color-panel-low)] px-2.5 py-1 text-sm text-[var(--color-fg)] transition-colors hover:border-[var(--color-border-hi)]"
        >
          <option value="">All</option>
          <option value="bo1">Bo1</option>
          <option value="bo3">Bo3</option>
          <option value="bo5">Bo5</option>
        </select>
      </label>
      {query.tab !== "maps" && <label className="flex min-w-0 items-center gap-2 text-sm text-[var(--color-fg-mid)]"><span>地图</span><select aria-label="统计地图范围" value={query.mapFilter} onChange={(e) => navigateStatsScope(router, seasonSlug, query, { mapFilter: e.target.value })} className="min-h-8 max-w-40 border border-[var(--color-border)] bg-[var(--color-panel-low)] px-2.5 py-1 text-sm"><option value="">全部地图</option>{maps.map((map) => <option key={map} value={map}>{map}</option>)}</select></label>}
    </div>
  );
}

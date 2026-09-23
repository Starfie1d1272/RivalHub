"use client";
import React from "react";

import { useRouter } from "next/navigation";
import type { StatsQuery } from "@/lib/stats/view-state";
import { navigateStatsScope } from "@/lib/stats/view-state";

export function StatsScopeBar({ query, seasonSlug, stages }: { query: StatsQuery; seasonSlug: string; stages: { key: string; name: string }[] }) {
  const router = useRouter();
  return (
    <label className="flex shrink-0 items-center gap-2 text-sm text-[var(--color-fg-mid)]">
      <span>Stage</span>
      <select
        value={query.stage}
        onChange={(event) => navigateStatsScope(router, seasonSlug, query, { stage: event.target.value })}
        className="min-h-8 min-w-32 border border-[var(--color-border)] bg-[var(--color-panel-low)] px-2.5 py-1 text-sm text-[var(--color-fg)] transition-colors hover:border-[var(--color-border-hi)]"
      >
        <option value="">All stages</option>
        {stages.map((stage) => <option key={stage.key} value={stage.key}>{stage.name}</option>)}
      </select>
    </label>
  );
}

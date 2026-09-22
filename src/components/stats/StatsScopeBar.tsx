"use client";
import React from "react";

import { useRouter } from "next/navigation";
import type { StatsQuery } from "@/lib/stats/view-state";
import { navigateStatsScope } from "@/lib/stats/view-state";

export function StatsScopeBar({
  query,
  seasonSlug,
  stages,
}: {
  query: StatsQuery;
  seasonSlug: string;
  stages: { key: string; name: string }[];
}) {
  const router = useRouter();
  return (
    <div className="flex min-w-0 flex-wrap items-end gap-3 rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)] p-3">
      <label className="grid gap-1 text-sm">阶段
        <select value={query.stage} onChange={(event) => navigateStatsScope(router, seasonSlug, query, { stage: event.target.value })}
          className="min-h-10 min-w-40 rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2">
          <option value="">全部阶段</option>
          {stages.map((stage) => <option key={stage.key} value={stage.key}>{stage.name}</option>)}
        </select>
      </label>
    </div>
  );
}

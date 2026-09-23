"use client";
import React from "react";

import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { STATS_TABS, statsHref, type StatsQuery, type StatsTab } from "@/lib/stats/view-state";
import { StatsScopeBar } from "./StatsScopeBar";

export function StatsShell({
  children, query, seasonSlug, stages, coverage, selectedTitle, directoryHref, directoryLabel,
}: {
  children: ReactNode; query: StatsQuery; seasonSlug: string; stages: { key: string; name: string }[];
  coverage: { detailedMaps: number; completedMaps: number }; selectedTitle?: string; directoryHref?: Route; directoryLabel?: string;
}) {
  const partialCoverage = coverage.completedMaps > 0 && coverage.detailedMaps < coverage.completedMaps;
  return (
    <div className="min-w-0 space-y-5">
      <div className="flex min-w-0 flex-col gap-2 border-b border-[var(--color-border)] sm:flex-row sm:items-end sm:justify-between">
        <nav aria-label="赛事统计" className="flex min-w-0 gap-1 overflow-x-auto">
          {(Object.entries(STATS_TABS) as [StatsTab, string][]).map(([tab, label]) => {
            const active = query.tab === tab;
            return (
              <Link
                key={tab}
                href={statsHref(seasonSlug, query, { tab })}
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={[
                  "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "border-[var(--color-accent)] text-[var(--color-fg)]"
                    : "border-transparent text-[var(--color-fg-mid)] hover:border-[var(--color-border-hi)] hover:text-[var(--color-fg)]",
                ].join(" ")}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="flex flex-wrap items-center gap-3 pb-2 sm:pb-1.5">
          {partialCoverage && <span className="text-xs text-[var(--color-fg-mid)]">Coverage {coverage.detailedMaps}/{coverage.completedMaps} maps</span>}
          <StatsScopeBar query={query} seasonSlug={seasonSlug} stages={stages} />
        </div>
      </div>
      {selectedTitle && directoryHref && (
        <nav aria-label="统计详情位置" className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={directoryHref} scroll={false} className="text-[var(--color-fg-mid)] hover:text-[var(--color-accent)]">{directoryLabel ?? "Back"}</Link>
          <span aria-hidden="true" className="text-[var(--color-fg-dim)]">›</span>
          <span aria-current="page" className="font-medium">{selectedTitle}</span>
        </nav>
      )}
      {children}
    </div>
  );
}

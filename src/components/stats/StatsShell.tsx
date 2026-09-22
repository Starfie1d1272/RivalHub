"use client";
import React from "react";

import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { STATS_TABS, statsHref, type StatsQuery, type StatsTab } from "@/lib/stats/view-state";
import { StatsScopeBar } from "./StatsScopeBar";

export function StatsShell({
  children,
  query,
  seasonSlug,
  stages,
  coverage,
  selectedTitle,
  directoryHref,
  directoryLabel,
}: {
  children: ReactNode;
  query: StatsQuery;
  seasonSlug: string;
  stages: { key: string; name: string }[];
  coverage: { detailedMaps: number; completedMaps: number };
  selectedTitle?: string;
  directoryHref?: Route;
  directoryLabel?: string;
}) {
  return (
    <div className="min-w-0 space-y-5">
      <nav aria-label="赛事统计" className="flex min-w-0 gap-2 overflow-x-auto pb-1">
        {(Object.entries(STATS_TABS) as [StatsTab, string][]).map(([tab, label]) => (
          <Link key={tab} href={statsHref(seasonSlug, query, { tab })} scroll={false} aria-current={query.tab === tab ? "page" : undefined}
            className={`whitespace-nowrap rounded-sm border px-4 py-2 text-sm ${query.tab === tab ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-[var(--color-border)] hover:bg-[var(--color-surface-raised)]"}`}>
            {label}
          </Link>
        ))}
      </nav>
      <StatsScopeBar query={query} seasonSlug={seasonSlug} stages={stages} />
      {selectedTitle && directoryHref && (
        <nav aria-label="统计详情位置" className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={directoryHref} scroll={false} className="text-[var(--color-fg-mid)] hover:text-[var(--color-accent)]">{directoryLabel ?? "返回列表"}</Link>
          <span aria-hidden="true" className="text-[var(--color-fg-dim)]">›</span>
          <span aria-current="page" className="font-medium">{selectedTitle}</span>
        </nav>
      )}
      <p className="text-sm text-[var(--color-fg-mid)]">DAK 详细数据覆盖 {coverage.detailedMaps}/{coverage.completedMaps} 张已完成地图。</p>
      {children}
    </div>
  );
}

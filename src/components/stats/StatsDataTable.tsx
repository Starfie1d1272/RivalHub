"use client";
import React, { Fragment, useMemo, useState, type ReactNode } from "react";

// Adapted from cs2-demo-analysis-kit
// packages/react/src/components/DataTable.tsx
// source: e98f6f7dae504466bdcfaf340d113eb4aeb7fe21
// MIT

import { PaginationControls } from "@/components/rivalhub";
import { StatsMetricHelp } from "@/components/stats/StatsMetricHelp";
import { StatsTooltip } from "@/components/stats/StatsTooltip";
import { STATS_METRICS, type StatsMetricKey } from "@/lib/stats/metrics";
import { getDynamicRankingFloor, isRankingEligible } from "@/lib/stats/ranking";
import { compareStatsValues, type StatsSortDirection, type StatsSortValue } from "@/lib/stats/sorting";

export interface StatsDataColumn<T> {
  key: string;
  label: string;
  metric?: StatsMetricKey;
  numeric?: boolean;
  sortable?: boolean;
  sortValue?: (row: T) => StatsSortValue;
  rankingSample?: (row: T) => number | null | undefined;
  render: (row: T, index: number) => ReactNode;
  className?: string;
}

interface RankingState<T> {
  rows: T[];
  rankedCount: number;
  limitedCount: number;
  floor: number;
  sampleLabel: string;
  metricLabel: string;
}

export function StatsDataTable<T>({
  rows, columns, rowKey, initialSortKey, initialDirection = "desc", pageSize = 25, showRank = false, embedded = false,
  tableClassName = "min-w-max", emptyLabel = "当前范围暂无数据", rankingBaselineRows,
}: {
  rows: readonly T[];
  columns: readonly StatsDataColumn<T>[];
  rowKey: (row: T, index: number) => string;
  initialSortKey?: string;
  initialDirection?: StatsSortDirection;
  pageSize?: number;
  showRank?: boolean;
  embedded?: boolean;
  tableClassName?: string;
  emptyLabel?: string;
  rankingBaselineRows?: readonly T[];
}) {
  const [sortKey, setSortKey] = useState(initialSortKey ?? "");
  const [direction, setDirection] = useState<StatsSortDirection>(initialDirection);
  const [page, setPage] = useState(1);
  const activeColumn = columns.find((item) => item.key === sortKey);

  const rankingState = useMemo<RankingState<T> | null>(() => {
    if (!activeColumn?.sortValue || !activeColumn.rankingSample) return null;
    const baseline = rankingBaselineRows ?? rows;
    const dynamicFloor = getDynamicRankingFloor(baseline.map((row) => {
      const value = activeColumn.sortValue!(row);
      return value === null || value === undefined ? null : activeColumn.rankingSample!(row);
    }));
    if (!dynamicFloor) return null;

    const ranked: T[] = [];
    const limited: T[] = [];
    for (const row of rows) {
      const value = activeColumn.sortValue(row);
      const hasValue = value !== null && value !== undefined;
      if (hasValue && isRankingEligible(activeColumn.rankingSample(row), dynamicFloor.floor)) ranked.push(row);
      else limited.push(row);
    }

    const compare = (left: T, right: T) => compareStatsValues(activeColumn.sortValue!(left), activeColumn.sortValue!(right), direction);
    ranked.sort(compare);
    limited.sort(compare);

    return {
      rows: [...ranked, ...limited],
      rankedCount: ranked.length,
      limitedCount: limited.length,
      floor: dynamicFloor.floor,
      sampleLabel: activeColumn.metric ? (STATS_METRICS[activeColumn.metric].rankingSampleLabel ?? STATS_METRICS[activeColumn.metric].sampleLabel) : "samples",
      metricLabel: activeColumn.label,
    };
  }, [activeColumn, direction, rankingBaselineRows, rows]);

  const sortedRows = useMemo(() => {
    if (rankingState) return rankingState.rows;
    if (!sortKey) return [...rows];
    const column = columns.find((item) => item.key === sortKey);
    if (!column?.sortValue) return [...rows];
    return [...rows].sort((left, right) => compareStatsValues(column.sortValue!(left), column.sortValue!(right), direction));
  }, [columns, direction, rankingState, rows, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageRows = sortedRows.slice(pageStart, safePage * pageSize);

  function sortBy(key: string) {
    if (sortKey === key) setDirection((current) => current === "desc" ? "asc" : "desc");
    else { setSortKey(key); setDirection("desc"); }
    setPage(1);
  }

  return (
    <div className={embedded ? "min-w-0" : "min-w-0 overflow-hidden border border-[var(--color-border)] bg-[var(--color-panel)]"}>
      {rankingState && rankingState.limitedCount > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-b border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-fg-dim)]">
          <span>{rankingState.rankedCount} ranked · {rankingState.limitedCount} limited sample</span>
          <span className="inline-flex items-center gap-1">
            <span>min {rankingState.floor} {rankingState.sampleLabel}</span>
            <StatsTooltip
              label="排名样本说明"
              content={`当前按 ${rankingState.metricLabel} 排序。排名样本线取当前 Stage/Map/Team 范围内有效样本 P75 的 25%，向上取整。Search 只过滤当前显示。`}
            />
          </span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className={`w-full ${tableClassName} text-sm`}>
          <thead className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]">
            <tr className="border-b border-[var(--color-border)]">
              {showRank && <th className="sticky left-0 z-20 w-12 min-w-12 max-w-12 whitespace-nowrap bg-[var(--color-panel)] px-3 py-3 text-left text-[var(--color-fg-dim)]">#</th>}
              {columns.map((column, index) => {
                const active = sortKey === column.key;
                const arrow = direction === "desc" ? "↓" : "↑";
                const sortLabel = active ? `${column.label} ${arrow}` : `Sort by ${column.label}`;
                return (
                  <th
                    key={column.key}
                    aria-sort={active ? direction === "desc" ? "descending" : "ascending" : "none"}
                    className={`whitespace-nowrap px-3 py-3 ${column.numeric ? "text-right" : "text-left"} ${column.className ?? ""} ${index === 0 ? `sticky ${showRank ? "left-12" : "left-0"} z-10 bg-[var(--color-panel)]` : ""}`}
                  >
                    <div className={`flex items-center ${column.numeric ? "justify-end" : "justify-start"}`}>
                      <span className="inline-flex items-center gap-1">
                        {column.sortable && column.sortValue ? (
                          <button
                            type="button"
                            aria-label={sortLabel}
                            onClick={() => sortBy(column.key)}
                            className={`inline-flex min-h-6 items-center transition-colors hover:text-[var(--color-fg)] ${active ? "text-[var(--color-fg)]" : ""}`}
                          >
                            {column.label}
                          </button>
                        ) : <span>{column.label}</span>}
                        {column.metric && <StatsMetricHelp metric={column.metric} />}
                      </span>
                      {active && <span aria-hidden="true" className="ml-1.5 text-[var(--color-accent)]">{arrow}</span>}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {pageRows.map((row, index) => {
              const globalIndex = pageStart + index;
              const limited = Boolean(rankingState && globalIndex >= rankingState.rankedCount);
              const limitedBoundary = rankingState && rankingState.limitedCount > 0 && globalIndex === rankingState.rankedCount;
              return (
                <Fragment key={rowKey(row, globalIndex)}>
                  {limitedBoundary && (
                    <tr>
                      <td colSpan={columns.length + Number(showRank)} className="bg-[var(--color-panel-low)] px-3 py-2 text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-dim)]">
                        Limited sample · below {rankingState.floor} {rankingState.sampleLabel}
                      </td>
                    </tr>
                  )}
                  <tr className="transition-colors hover:bg-[var(--color-panel-hi)]">
                    {showRank && (
                      <td className={`sticky left-0 z-10 w-12 min-w-12 max-w-12 bg-[var(--color-panel)] px-3 py-2.5 font-mono tabular-nums ${globalIndex === 0 ? "font-semibold text-[var(--color-accent)]" : "text-[var(--color-fg-dim)]"}`}>
                        {limited ? "—" : globalIndex + 1}
                      </td>
                    )}
                    {columns.map((column, columnIndex) => (
                      <td key={column.key} className={`whitespace-nowrap px-3 py-2.5 ${column.numeric ? "text-right tabular-nums" : "text-left"} ${column.className ?? ""} ${columnIndex === 0 ? `sticky ${showRank ? "left-12" : "left-0"} z-10 bg-[var(--color-panel)]` : ""}`}>
                        {column.render(row, globalIndex)}
                      </td>
                    ))}
                  </tr>
                </Fragment>
              );
            })}
            {pageRows.length === 0 && <tr><td colSpan={columns.length + Number(showRank)} className="px-4 py-8 text-center text-[var(--color-fg-mid)]">{emptyLabel}</td></tr>}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && <div className="border-t border-[var(--color-border)] p-3"><PaginationControls page={safePage} totalPages={totalPages} onPageChange={setPage} /></div>}
    </div>
  );
}

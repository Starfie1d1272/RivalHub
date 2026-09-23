"use client";
import React from "react";

// Adapted from cs2-demo-analysis-kit
// packages/react/src/components/DataTable.tsx
// source: e98f6f7dae504466bdcfaf340d113eb4aeb7fe21
// MIT

import { useMemo, useState, type ReactNode } from "react";
import { Panel, PaginationControls } from "@/components/rivalhub";
import { compareStatsValues, type StatsSortDirection, type StatsSortValue } from "@/lib/stats/sorting";

export interface StatsDataColumn<T> {
  key: string;
  label: string;
  numeric?: boolean;
  sortable?: boolean;
  sortValue?: (row: T) => StatsSortValue;
  render: (row: T, index: number) => ReactNode;
  className?: string;
}

export function StatsDataTable<T>({
  rows,
  columns,
  rowKey,
  initialSortKey,
  initialDirection = "desc",
  pageSize = 25,
  showRank = false,
  emptyLabel = "当前范围暂无数据",
}: {
  rows: readonly T[];
  columns: readonly StatsDataColumn<T>[];
  rowKey: (row: T, index: number) => string;
  initialSortKey?: string;
  initialDirection?: StatsSortDirection;
  pageSize?: number;
  showRank?: boolean;
  emptyLabel?: string;
}) {
  const [sortKey, setSortKey] = useState(initialSortKey ?? "");
  const [direction, setDirection] = useState<StatsSortDirection>(initialDirection);
  const [page, setPage] = useState(1);
  const sortedRows = useMemo(() => {
    if (!sortKey) return [...rows];
    const column = columns.find((item) => item.key === sortKey);
    if (!column?.sortValue) return [...rows];
    return [...rows].sort((left, right) => compareStatsValues(column.sortValue!(left), column.sortValue!(right), direction));
  }, [columns, direction, rows, sortKey]);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  function sortBy(key: string) {
    if (sortKey === key) setDirection((current) => current === "desc" ? "asc" : "desc");
    else {
      setSortKey(key);
      setDirection("desc");
    }
    setPage(1);
  }

  return (
    <Panel contentClassName="p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead className="text-xs uppercase tracking-wide text-[var(--color-fg-mid)]">
            <tr className="border-b border-[var(--color-border)]">
              {showRank && <th className="sticky left-0 z-20 w-12 min-w-12 max-w-12 whitespace-nowrap bg-[var(--color-panel)] px-3 py-3 text-left">#</th>}
              {columns.map((column, index) => {
                const active = sortKey === column.key;
                const sortLabel = active ? `${column.label} ${direction === "desc" ? "↓" : "↑"}` : column.label;
                return (
                  <th key={column.key} aria-sort={active ? direction === "desc" ? "descending" : "ascending" : "none"}
                    className={`whitespace-nowrap px-3 py-3 ${column.numeric ? "text-right" : "text-left"} ${column.className ?? ""} ${index === 0 ? `sticky ${showRank ? "left-12" : "left-0"} z-10 bg-[var(--color-panel)]` : ""}`}>
                    {column.sortable && column.sortValue
                      ? <button type="button" onClick={() => sortBy(column.key)} className="inline-flex min-h-6 items-center gap-1 hover:text-[var(--color-accent)]">{sortLabel}</button>
                      : column.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {pageRows.map((row, index) => (
              <tr key={rowKey(row, (safePage - 1) * pageSize + index)} className="hover:bg-[var(--color-surface-raised)]">
                {showRank && <td className="sticky left-0 z-10 w-12 min-w-12 max-w-12 bg-[var(--color-panel)] px-3 py-2.5 tabular-nums">{(safePage - 1) * pageSize + index + 1}</td>}
                {columns.map((column, columnIndex) => (
                  <td key={column.key} className={`whitespace-nowrap px-3 py-2.5 ${column.numeric ? "text-right tabular-nums" : "text-left"} ${column.className ?? ""} ${columnIndex === 0 ? `sticky ${showRank ? "left-12" : "left-0"} z-10 bg-[var(--color-panel)]` : ""}`}>
                    {column.render(row, (safePage - 1) * pageSize + index)}
                  </td>
                ))}
              </tr>
            ))}
            {pageRows.length === 0 && <tr><td colSpan={columns.length + Number(showRank)} className="px-4 py-8 text-center text-[var(--color-fg-mid)]">{emptyLabel}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="border-t border-[var(--color-border)] p-3">
        <PaginationControls page={safePage} totalPages={totalPages} onPageChange={setPage} />
        <p className="mt-2 text-center text-xs text-[var(--color-fg-dim)]">共 {sortedRows.length} 条</p>
      </div>
    </Panel>
  );
}

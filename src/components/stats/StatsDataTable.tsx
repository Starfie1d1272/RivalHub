"use client";
import React from "react";

// Adapted from cs2-demo-analysis-kit
// packages/react/src/components/DataTable.tsx
// source: e98f6f7dae504466bdcfaf340d113eb4aeb7fe21
// MIT

import { useMemo, useState, type ReactNode } from "react";
import { PaginationControls } from "@/components/rivalhub";
import { compareStatsValues, type StatsSortDirection, type StatsSortValue } from "@/lib/stats/sorting";

export interface StatsDataColumn<T> {
  key: string; label: string; numeric?: boolean; sortable?: boolean;
  sortValue?: (row: T) => StatsSortValue; render: (row: T, index: number) => ReactNode; className?: string;
}

export function StatsDataTable<T>({
  rows, columns, rowKey, initialSortKey, initialDirection = "desc", pageSize = 25, showRank = false, embedded = false,
  tableClassName = "min-w-max", emptyLabel = "当前范围暂无数据",
}: {
  rows: readonly T[]; columns: readonly StatsDataColumn<T>[]; rowKey: (row: T, index: number) => string;
  initialSortKey?: string; initialDirection?: StatsSortDirection; pageSize?: number; showRank?: boolean; embedded?: boolean;
  tableClassName?: string; emptyLabel?: string;
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
    else { setSortKey(key); setDirection("desc"); }
    setPage(1);
  }

  return (
    <div className={embedded ? "min-w-0" : "min-w-0 overflow-hidden border border-[var(--color-border)] bg-[var(--color-panel)]"}>
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
                    {column.sortable && column.sortValue ? (
                      <button
                        type="button"
                        aria-label={sortLabel}
                        onClick={() => sortBy(column.key)}
                        className={`group inline-flex min-h-6 items-center gap-1.5 transition-colors hover:text-[var(--color-fg)] ${active ? "text-[var(--color-fg)]" : ""}`}
                      >
                        <span>{column.label}</span>
                        <span aria-hidden="true" className={active ? "text-[var(--color-accent)]" : "text-[var(--color-fg-dim)] opacity-0 transition-opacity group-hover:opacity-100"}>{active ? arrow : "↕"}</span>
                      </button>
                    ) : column.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {pageRows.map((row, index) => (
              <tr key={rowKey(row, (safePage - 1) * pageSize + index)} className="transition-colors hover:bg-[var(--color-panel-hi)]">
                {showRank && (
                  <td className={`sticky left-0 z-10 w-12 min-w-12 max-w-12 bg-[var(--color-panel)] px-3 py-2.5 font-mono tabular-nums ${index === 0 && safePage === 1 ? "font-semibold text-[var(--color-accent)]" : "text-[var(--color-fg-dim)]"}`}>
                    {(safePage - 1) * pageSize + index + 1}
                  </td>
                )}
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
      {totalPages > 1 && <div className="border-t border-[var(--color-border)] p-3"><PaginationControls page={safePage} totalPages={totalPages} onPageChange={setPage} /></div>}
    </div>
  );
}

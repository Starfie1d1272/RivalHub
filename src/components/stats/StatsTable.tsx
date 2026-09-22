import React from "react";
import type { Route } from "next";
import type { ReactNode } from "react";
import type { StatsSortDirection } from "@/lib/stats/sorting";
import { Panel } from "@/components/rivalhub";
import { StatsLink } from "./StatsLink";

export interface StatsTableColumn<T> {
  key: string;
  label: string;
  numeric?: boolean;
  sortable?: boolean;
  render: (row: T, index: number) => ReactNode;
}

interface StatsTableProps<T> {
  rows: readonly T[];
  columns: readonly StatsTableColumn<T>[];
  rowKey: (row: T, index: number) => string;
  sort?: string;
  direction?: StatsSortDirection;
  sortHref?: (key: string, direction: StatsSortDirection) => Route;
  activeRowKey?: string;
  rankOffset?: number;
  empty?: ReactNode;
  className?: string;
  tableClassName?: string;
}

export function StatsTable<T>({
  rows,
  columns,
  rowKey,
  sort,
  direction = "desc",
  sortHref,
  activeRowKey,
  rankOffset,
  empty,
  className,
  tableClassName,
}: StatsTableProps<T>) {
  const hasRank = rankOffset !== undefined;
  return (
    <Panel className={className} contentClassName="p-0">
      <div className="overflow-x-auto">
        <table className={`w-full text-sm ${tableClassName ?? ""}`}>
          <thead>
            <tr className="border-b border-[var(--color-border)] text-xs uppercase tracking-wide text-[var(--color-fg-mid)]">
              {hasRank && <th className="whitespace-nowrap px-3 py-3 text-left">#</th>}
              {columns.map((column) => {
                const active = sort === column.key;
                const nextDirection: StatsSortDirection = active && direction === "desc" ? "asc" : "desc";
                const label = active ? `${column.label} ${direction === "desc" ? "↓" : "↑"}` : column.label;
                const header = column.sortable && sortHref
                  ? <StatsLink href={sortHref(column.key, nextDirection)} aria-label={column.label} className="inline-flex items-center gap-1 hover:text-[var(--color-accent)]">{label}</StatsLink>
                  : label;
                return (
                  <th
                    key={column.key}
                    aria-sort={active ? direction === "asc" ? "ascending" : "descending" : "none"}
                    className={`whitespace-nowrap px-3 py-3 ${column.numeric ? "text-right" : "text-left"}`}
                  >
                    {header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {rows.map((row, index) => {
              const key = rowKey(row, index);
              const rank = hasRank ? rankOffset + index + 1 : null;
              return (
                <tr key={key} className={activeRowKey === key ? "bg-[color-mix(in_srgb,var(--color-accent)_7%,transparent)]" : "hover:bg-[var(--color-surface-raised)]"}>
                  {hasRank && (
                    <td className="px-3 py-2.5 text-left text-xs">
                      <span className={rank !== null && rank <= 3 ? "font-bold text-[var(--color-accent)]" : "text-[var(--color-fg-dim)]"}>{rank}</span>
                    </td>
                  )}
                  {columns.map((column) => (
                    <td key={column.key} className={`px-3 py-2.5 ${column.numeric ? "text-right tabular-nums" : "text-left"}`}>
                      {column.render(row, index)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && empty}
      </div>
    </Panel>
  );
}

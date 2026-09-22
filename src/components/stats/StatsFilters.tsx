"use client";

import { useRef } from "react";
import { ListToolbar } from "@/components/rivalhub/ListToolbar";
import { ListSearchField, type ListSearchFieldHandle } from "@/components/rivalhub/ListSearchField";
import { ClearFilters } from "@/components/rivalhub/ClearFilters";
import { PaginationControls } from "@/components/rivalhub/PaginationControls";
import { useListQueryParams } from "@/components/rivalhub/useListQueryParams";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";
import type { StatsQuery } from "@/lib/stats/query-state";

export function StatsFilters({ query, stages, maps, teams }: { query: StatsQuery; stages: { key: string; name: string }[]; maps: string[]; teams: { id: string; name: string }[] }) {
  const { searchParams, update: updateQuery } = useListQueryParams({ preserveScroll: true });
  const search = useRef<ListSearchFieldHandle>(null);
  return <ListToolbar>
    {([
      ["stage", "阶段", stages.map((row) => ({ key: row.key, label: row.name }))],
      ["map", "地图", maps.map((key) => ({ key, label: CS2_MAP_CATALOG.find((map) => map.key === key)?.label ?? "其他地图" }))],
      ["team", "队伍", teams.map((row) => ({ key: row.id, label: row.name }))],
    ] as const).map(([key, label, options]) => <label key={key} className="grid gap-1 text-sm">{label}<select value={query[key]} onChange={(event) => { search.current?.cancelPending(); updateQuery({ [key]: event.target.value }); }} className="max-w-56 rounded border p-2 bg-[var(--color-panel)]"><option value="">全部{label}</option>{options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>)}
    {query.tab === "players" && <ListSearchField ref={search} queryKey="q" label="搜索选手" value={query.q} onDebouncedChange={(q) => updateQuery({ q })} />}
    <ClearFilters defaults={{ stage: "", map: "", team: "", q: "", side: "overall" }} searchParams={searchParams} onClear={(updates) => { search.current?.reset(); updateQuery(updates, { defaults: { side: "overall" } }); }} />
  </ListToolbar>;
}
export function StatsPagination({ page, totalPages }: { page: number; totalPages: number }) {
  const { update: updateQuery } = useListQueryParams({ preserveScroll: true });
  return <PaginationControls page={page} totalPages={totalPages} onPageChange={(page) => updateQuery({ page }, { defaults: { page: 1 } })} />;
}

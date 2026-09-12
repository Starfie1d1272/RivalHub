"use client";

import { useRef } from "react";
import { ListToolbar, ListSearchField, ClearFilters, ResultSummary } from "@/components/rivalhub";
import type { ListSearchFieldHandle } from "@/components/rivalhub/ListSearchField";
import { useListQueryParams } from "@/components/rivalhub/useListQueryParams";

export function ParticipantDirectoryToolbar({
  query,
  team = "",
  teams,
  position = "",
  positions,
  total,
}: {
  query: string;
  team?: string;
  teams?: { id: string; name: string }[];
  position?: string;
  positions?: { value: string; label: string }[];
  total: number;
}) {
  const { searchParams, update } = useListQueryParams();
  const search = useRef<ListSearchFieldHandle>(null);
  return (
    <ListToolbar>
      <ListSearchField
        ref={search}
        queryKey="q"
        label={teams || positions ? "搜索选手" : "搜索队伍或选手"}
        value={query}
        onDebouncedChange={(q) => update({ q }, { history: "push" })}
        className="flex-1 basis-48"
      />
      {teams && (
        <label className="grid gap-1.5 text-xs text-[var(--color-fg-mid)]">
          所属队伍
          <select
            value={team}
            className="h-9 max-w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)] px-3 text-sm"
            onChange={(e) => {
              search.current?.cancelPending();
              update({ team: e.target.value }, { history: "push" });
            }}
          >
            <option value="">全部队伍</option>
            {teams.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {positions && (
        <label className="grid gap-1.5 text-xs text-[var(--color-fg-mid)]">
          位置
          <select
            value={position}
            className="h-9 max-w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)] px-3 text-sm"
            onChange={(e) => {
              search.current?.cancelPending();
              update({ position: e.target.value }, { history: "push" });
            }}
          >
            <option value="">全部位置</option>
            {positions.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <ClearFilters
        keys={["q", "team", "position"]}
        searchParams={searchParams}
        onClear={(values) => {
          search.current?.reset();
          update(values, { history: "push" });
        }}
      />
      <ResultSummary total={total} page={1} pageSize={Math.max(total, 1)} />
    </ListToolbar>
  );
}

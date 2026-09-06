"use client";

import { useRef } from "react";
import {
  ClearFilters,
  ListSearchField,
  ListToolbar,
  type ListSearchFieldHandle,
  useListQueryParams,
} from "@/components/rivalhub";
import {
  TEAM_DIRECTORY_DEFAULTS,
  type TeamDirectoryQuery,
  type TeamDirectorySort,
  type TeamDirectoryStatus,
} from "@/lib/teams/directory-contract";

const STATUS_OPTIONS: Array<{ value: TeamDirectoryStatus; label: string }> = [
  { value: "active", label: "活跃队伍" },
  { value: "history", label: "历史队伍" },
];

const SORT_OPTIONS: Array<{ value: TeamDirectorySort; label: string }> = [
  { value: "default", label: "招募优先" },
  { value: "name", label: "队名" },
  { value: "members_asc", label: "成员数从少到多" },
  { value: "members_desc", label: "成员数从多到少" },
];

const selectClassName = "h-10 min-w-0 max-w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)] px-3 text-sm text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]";

interface TeamDirectoryControlsProps {
  normalizedQuery: TeamDirectoryQuery;
}

function optionValue<T extends string>(value: string | null, options: readonly { value: T; label: string }[], fallback: T): T {
  return options.some((option) => option.value === value) ? value as T : fallback;
}

export function TeamDirectoryControls({ normalizedQuery }: TeamDirectoryControlsProps) {
  const { searchParams, update } = useListQueryParams({ routeBase: "/teams", defaults: TEAM_DIRECTORY_DEFAULTS });
  const searchFieldRef = useRef<ListSearchFieldHandle>(null);
  const currentStatus = optionValue(searchParams.get("status"), STATUS_OPTIONS, normalizedQuery.status);
  const currentSort = optionValue(searchParams.get("sort"), SORT_OPTIONS, normalizedQuery.sort);
  const currentRecruiting = searchParams.get("recruiting") === "true"
    || searchParams.get("recruiting") === "1"
    || normalizedQuery.recruiting;

  return (
    <ListToolbar aria-label="队伍目录搜索与筛选" className="items-start">
      <ListSearchField
        ref={searchFieldRef}
        queryKey="q"
        label="搜索队伍"
        placeholder="队名 / 队长姓名…"
        value={searchParams.get("q") ?? normalizedQuery.q ?? ""}
        onDebouncedChange={(value) => update({ q: value })}
        className="min-w-0 w-full flex-1 basis-full lg:basis-[32%]"
      />
      <label className="min-w-0 w-full flex-1 basis-full sm:basis-[calc(50%-0.75rem)] lg:basis-[20%]">
        <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">队伍状态</span>
        <select
          aria-label="队伍状态"
          value={currentStatus}
          onChange={(event) => update({ status: event.target.value })}
          className={selectClassName}
        >
          {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label className="flex min-h-10 min-w-0 flex-1 basis-full items-center gap-2 sm:basis-[calc(50%-0.75rem)] lg:basis-[18%] lg:pt-6">
        <input
          type="checkbox"
          checked={currentRecruiting}
          onChange={(event) => update({ recruiting: event.target.checked })}
          className="size-4 accent-[var(--color-accent)]"
        />
        <span className="text-sm text-[var(--color-fg-mid)]">只看招募中</span>
      </label>
      <label className="min-w-0 w-full flex-1 basis-full sm:basis-[calc(50%-0.75rem)] lg:basis-[22%]">
        <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">排序</span>
        <select
          aria-label="队伍目录排序"
          value={currentSort}
          onChange={(event) => update({ sort: event.target.value })}
          className={selectClassName}
        >
          {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <ClearFilters
        defaults={TEAM_DIRECTORY_DEFAULTS}
        searchParams={searchParams}
        onClear={(updates) => {
          searchFieldRef.current?.reset();
          update(updates);
        }}
      />
    </ListToolbar>
  );
}

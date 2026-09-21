"use client";

import React, { useRef } from "react";
import { ClearFilters, ListSearchField, ListToolbar, type ListSearchFieldHandle } from "@/components/rivalhub";
import type { ListQuerySearchParams, ListQueryUpdate } from "@/components/rivalhub/useListQueryParams";
import { Button } from "@/components/ui/button";
import {
  ADMIN_USERS_DEFAULTS,
  type AdminUserActivityFilter,
  type AdminUserEducationFilter,
  type AdminUserTeamFilter,
  type AdminUserParticipationFilter,
} from "@/lib/admin/users-contract";

const FILTERS = [
  { key: "all",          label: "全部" },
  { key: "participated", label: "参赛过" },
  { key: "none",         label: "仅注册" },
] as const;

export type UserFilter = AdminUserParticipationFilter;

const SELECT_CLASS_NAME = "min-w-0 max-w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)] px-3 py-2 text-sm text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]";

const EDUCATION_OPTIONS = [
  { value: "all", label: "全部教育状态" },
  { value: "approved", label: "已认证" },
  { value: "unverified", label: "未认证" },
] as const satisfies ReadonlyArray<{ value: AdminUserEducationFilter; label: string }>;

const TEAM_OPTIONS = [
  { value: "all", label: "全部队伍状态" },
  { value: "in_team", label: "当前有队伍" },
  { value: "none", label: "当前无队伍" },
] as const satisfies ReadonlyArray<{ value: AdminUserTeamFilter; label: string }>;

const ACTIVITY_OPTIONS = [
  { value: "all", label: "全部活跃状态" },
  { value: "24h", label: "近 24 小时" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
] as const satisfies ReadonlyArray<{ value: AdminUserActivityFilter; label: string }>;

interface UserSearchBarProps {
  filter: UserFilter;
  education: AdminUserEducationFilter;
  team: AdminUserTeamFilter;
  activity: AdminUserActivityFilter;
  searchParams: ListQuerySearchParams;
  update: ListQueryUpdate;
}

export function UserSearchBar({ filter, education, team, activity, searchParams, update }: UserSearchBarProps) {
  const searchFieldRef = useRef<ListSearchFieldHandle>(null);
  return (
    <ListToolbar aria-label="用户搜索与筛选">
      <ListSearchField
        ref={searchFieldRef}
        queryKey="q"
        label="搜索用户"
        placeholder="昵称 / 邮箱 / Steam64 ID…"
        value={searchParams.get("q") ?? ""}
        onDebouncedChange={(value) => update({ q: value })}
        className="min-w-0 flex-1 basis-full md:basis-auto"
      />
      <div className="min-w-0">
        <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">参赛状态</span>
        <div className="flex flex-wrap gap-1" role="group" aria-label="参赛状态">
        {FILTERS.map(({ key, label }) => (
            <Button
              key={key}
              type="button"
              size="sm"
              variant={filter !== key ? "ghost" : "outline"}
              onClick={() => update({ tab: "users", filter: key })}
            >
              {label}
            </Button>
        ))}
        </div>
      </div>
      <FilterSelect
        ariaLabel="教育认证"
        value={(searchParams.get("education") as AdminUserEducationFilter | null) ?? education}
        options={EDUCATION_OPTIONS}
        onChange={(value) => update({ tab: "users", education: value })}
      />
      <FilterSelect
        ariaLabel="队伍状态"
        value={(searchParams.get("team") as AdminUserTeamFilter | null) ?? team}
        options={TEAM_OPTIONS}
        onChange={(value) => update({ tab: "users", team: value })}
      />
      <FilterSelect
        ariaLabel="最近活跃"
        value={(searchParams.get("activity") as AdminUserActivityFilter | null) ?? activity}
        options={ACTIVITY_OPTIONS}
        onChange={(value) => update({ tab: "users", activity: value })}
      />
      <ClearFilters
        defaults={ADMIN_USERS_DEFAULTS}
        searchParams={searchParams}
        onClear={(updates) => {
          searchFieldRef.current?.reset();
          update(updates);
        }}
      />
    </ListToolbar>
  );
}

function FilterSelect<T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
}: {
  ariaLabel: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="min-w-0 w-full sm:w-auto">
      <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">{ariaLabel}</span>
      <select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value as T)} className={SELECT_CLASS_NAME}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

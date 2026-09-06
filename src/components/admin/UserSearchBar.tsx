"use client";

import React, { useRef } from "react";
import { ClearFilters, ListSearchField, ListToolbar, type ListSearchFieldHandle } from "@/components/rivalhub";
import type { ListQuerySearchParams, ListQueryUpdate } from "@/components/rivalhub/useListQueryParams";
import { Button } from "@/components/ui/button";
import { ADMIN_USERS_DEFAULTS } from "@/lib/admin/users-contract";

const FILTERS = [
  { key: "all",          label: "全部" },
  { key: "participated", label: "参赛过" },
  { key: "none",         label: "仅注册" },
] as const;

export type UserFilter = (typeof FILTERS)[number]["key"];

interface UserSearchBarProps {
  filter: UserFilter;
  searchParams: ListQuerySearchParams;
  update: ListQueryUpdate;
}

export function UserSearchBar({ filter, searchParams, update }: UserSearchBarProps) {
  const searchFieldRef = useRef<ListSearchFieldHandle>(null);
  return (
    <ListToolbar aria-label="用户搜索与筛选">
      <ListSearchField
        ref={searchFieldRef}
        queryKey="q"
        label="搜索用户"
        placeholder="姓名 / 邮箱…"
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

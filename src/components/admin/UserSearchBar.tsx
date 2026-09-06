"use client";

import React from "react";
import { ClearFilters, ListSearchField, ListToolbar, useListQueryParams } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";

const FILTERS = [
  { key: "all",          label: "全部" },
  { key: "participated", label: "参赛过" },
  { key: "none",         label: "仅注册" },
] as const;

type UserFilter = (typeof FILTERS)[number]["key"];

export function UserSearchBar({ filter }: { filter: UserFilter }) {
  const { update } = useListQueryParams({ routeBase: "/admin/users", defaults: { filter: "all" } });
  return (
    <ListToolbar aria-label="用户搜索与筛选">
      <ListSearchField
        queryKey="q"
        label="搜索用户"
        placeholder="姓名 / 邮箱…"
        routeBase="/admin/users"
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
              onClick={() => update({ tab: "users", filter: key }, { defaults: { filter: "all" } })}
            >
              {label}
            </Button>
        ))}
        </div>
      </div>
      <ClearFilters defaults={{ q: "", filter: "all" }} routeBase="/admin/users" />
    </ListToolbar>
  );
}

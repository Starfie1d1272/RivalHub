"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { applyListQueryUpdates } from "@/lib/list-query";
import {
  parseStatsReadingState,
  STATS_QUERY_VALUE_LIMIT,
  type StatsQuery,
} from "@/lib/stats/view-state";

export function useStatsReadingState() {
  const params = useSearchParams();
  return parseStatsReadingState((key) => params.get(key));
}

export function useStatsSearchField() {
  const params = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = searchRef.current;
    if (!input) return;
    // The URL can be ahead of the router snapshot during rapid typing.
    const value =
      new URLSearchParams(window.location.search).get("q")?.slice(0, STATS_QUERY_VALUE_LIMIT) ?? "";
    if (input.value !== value) input.value = value;
  }, [params]);
  return { searchRef, ...parseStatsReadingState((key) => params.get(key)) };
}

export function replaceStatsReadingState(
  updates: Pick<StatsQuery, "sort" | "direction" | "page" | "family" | "q">,
) {
  const url = new URL(window.location.href);
  url.search = applyListQueryUpdates(
    url.searchParams,
    {
      ...(updates.family !== undefined && { sort: "", direction: undefined }),
      ...updates,
      ...(updates.q !== undefined && { q: updates.q.slice(0, STATS_QUERY_VALUE_LIMIT) }),
    },
    { defaults: { page: 1 } },
  ).toString();
  window.history.replaceState(null, "", url);
}

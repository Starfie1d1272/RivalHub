"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { StatsDataTable } from "./StatsDataTable";
import type { ComponentProps } from "react";

/** URL state is opt-in; small embedded tables retain their local state. */
export function StatsExplorerTable<T>(props: ComponentProps<typeof StatsDataTable<T>>) {
  const router = useRouter();
  const params = useSearchParams();
  const requestedKey = params.get("sort") ?? "";
  const sortKey = props.columns.some(column => column.key === requestedKey && column.sortable && column.sortValue) ? requestedKey : props.initialSortKey ?? "";
  const requestedPage = params.get("page") ?? "";
  const page = /^[1-9][0-9]{0,3}$/.test(requestedPage) ? Number(requestedPage) : 1;
  return <StatsDataTable {...props} state={{ sortKey, direction: params.get("direction") === "asc" ? "asc" : "desc", page }} onStateChange={next => {
    const query = new URLSearchParams(params.toString());
    query.set("sort", next.sortKey);
    query.set("direction", next.direction);
    if (next.page > 1) query.set("page", String(next.page)); else query.delete("page");
    router.replace(`?${query}`, { scroll: false });
  }} />;
}

"use client";
import { StatsDataTable } from "./StatsDataTable";
import type { ComponentProps } from "react";
import { replaceStatsReadingState, useStatsReadingState } from "./reading-state";

/** URL state is opt-in; small embedded tables retain their local state. */
export function StatsExplorerTable<T>(props: ComponentProps<typeof StatsDataTable<T>>) {
  const { sort: requestedKey, direction, page } = useStatsReadingState();
  const sortKey = props.columns.some(
    (column) => column.key === requestedKey && column.sortable && column.sortValue,
  )
    ? requestedKey
    : (props.initialSortKey ?? "");
  return (
    <StatsDataTable
      {...props}
      state={{ sortKey, direction: direction ?? "desc", page }}
      onStateChange={({ sortKey, direction, page }) =>
        replaceStatsReadingState({ sort: sortKey, direction, page })
      }
    />
  );
}

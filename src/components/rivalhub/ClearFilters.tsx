"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { useListQueryParams, type ListQueryDefaults, type ListQueryValue } from "./useListQueryParams";

interface ClearFiltersProps {
  defaults?: ListQueryDefaults;
  keys?: readonly string[];
  routeBase?: string;
  label?: string;
}

function normalized(value: ListQueryValue): string | undefined {
  return value === null || value === undefined || value === "" ? undefined : String(value);
}

export function ClearFilters({ defaults = {}, keys, routeBase, label = "清除筛选" }: ClearFiltersProps) {
  const { searchParams, update } = useListQueryParams({ routeBase, defaults });
  const filterKeys = keys ?? Object.keys(defaults);
  const active = filterKeys.some((key) => {
    const defaultValue = normalized(defaults[key]);
    const currentValue = normalized(searchParams.get(key)) ?? defaultValue;
    return currentValue !== defaultValue;
  });
  if (!active) return null;

  const clearUpdates = Object.fromEntries(filterKeys.map((key) => [key, defaults[key]]));
  return (
    <Button type="button" size="sm" variant="ghost" onClick={() => update(clearUpdates, { defaults })}>
      {label}
    </Button>
  );
}

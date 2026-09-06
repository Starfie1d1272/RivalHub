"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import type {
  ListQueryDefaults,
  ListQuerySearchParams,
  ListQueryUpdates,
  ListQueryValue,
} from "./useListQueryParams";

interface ClearFiltersProps {
  defaults?: ListQueryDefaults;
  keys?: readonly string[];
  searchParams: ListQuerySearchParams;
  onClear: (updates: ListQueryUpdates) => void;
  label?: string;
}

function normalized(value: ListQueryValue): string | undefined {
  return value === null || value === undefined || value === "" ? undefined : String(value);
}

export function ClearFilters({ defaults = {}, keys, searchParams, onClear, label = "清除筛选" }: ClearFiltersProps) {
  const filterKeys = keys ?? Object.keys(defaults);
  const active = filterKeys.some((key) => {
    const defaultValue = normalized(defaults[key]);
    const currentValue = normalized(searchParams.get(key)) ?? defaultValue;
    return currentValue !== defaultValue;
  });
  if (!active) return null;

  const clearUpdates: ListQueryUpdates = Object.fromEntries(filterKeys.map((key) => [key, defaults[key]]));
  return (
    <Button type="button" size="sm" variant="ghost" onClick={() => onClear(clearUpdates)}>
      {label}
    </Button>
  );
}

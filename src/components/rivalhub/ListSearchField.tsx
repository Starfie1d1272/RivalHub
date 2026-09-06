"use client";

import React, { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";
import { useListQueryParams, type ListQueryDefaults } from "./useListQueryParams";

interface ListSearchFieldProps {
  queryKey: string;
  label: string;
  placeholder?: string;
  debounceMs?: number;
  routeBase?: string;
  defaults?: ListQueryDefaults;
  id?: string;
  className?: string;
}

function defaultId(queryKey: string): string {
  return `list-search-${queryKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function ListSearchField({
  queryKey,
  label,
  placeholder,
  debounceMs = 300,
  routeBase,
  defaults,
  id,
  className,
}: ListSearchFieldProps) {
  const { searchParams, update } = useListQueryParams({ routeBase, defaults });
  const externalValue = searchParams.get(queryKey) ?? "";
  const [localValue, setLocalValue] = useState(externalValue);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputId = id ?? defaultId(queryKey);

  useEffect(() => {
    setLocalValue(externalValue);
  }, [externalValue]);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setLocalValue(value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => update({ [queryKey]: value }, { defaults }), debounceMs);
  }

  return (
    <div className={cn("min-w-0", className)}>
      <Label htmlFor={inputId} className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">
        {label}
      </Label>
      <Input
        id={inputId}
        type="search"
        value={localValue}
        onChange={handleChange}
        placeholder={placeholder}
        className="min-w-0 max-w-full"
      />
    </div>
  );
}

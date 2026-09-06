"use client";

import React, { useEffect, useRef, type ChangeEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";

interface ListSearchFieldProps {
  queryKey: string;
  label: string;
  placeholder?: string;
  value: string;
  onDebouncedChange: (value: string) => void;
  debounceMs?: number;
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
  value,
  onDebouncedChange,
  debounceMs = 300,
  id,
  className,
}: ListSearchFieldProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputId = id ?? defaultId(queryKey);

  useEffect(() => {
    clearTimeout(timerRef.current);
  }, [value]);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onDebouncedChange(value), debounceMs);
  }

  return (
    <div className={cn("min-w-0", className)}>
      <Label htmlFor={inputId} className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">
        {label}
      </Label>
      <Input
        id={inputId}
        type="search"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        className="min-w-0 max-w-full"
      />
    </div>
  );
}

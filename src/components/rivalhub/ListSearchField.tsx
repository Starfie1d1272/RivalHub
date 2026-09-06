"use client";

import React, { useCallback, useEffect, useImperativeHandle, useRef, useState, type ChangeEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";

export interface ListSearchFieldHandle {
  reset(value?: string): void;
  cancelPending(): void;
}

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

export const ListSearchField = React.forwardRef<ListSearchFieldHandle, ListSearchFieldProps>(function ListSearchField({
  queryKey,
  label,
  placeholder,
  value,
  onDebouncedChange,
  debounceMs = 300,
  id,
  className,
}, ref) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [localValue, setLocalValue] = useState(value);
  const inputId = id ?? defaultId(queryKey);
  const cancelPending = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
  }, []);

  useImperativeHandle(ref, () => ({
    reset(nextValue = "") {
      cancelPending();
      setLocalValue(nextValue);
    },
    cancelPending,
  }), [cancelPending]);

  useEffect(() => {
    cancelPending();
    setLocalValue(value);
  }, [cancelPending, value]);

  useEffect(() => {
    return cancelPending;
  }, [cancelPending]);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.value;
    setLocalValue(nextValue);
    cancelPending();
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      onDebouncedChange(nextValue);
    }, debounceMs);
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
});

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
  const pendingValueRef = useRef<string | undefined>(undefined);
  const ignoredControlledValuesRef = useRef(new Set<string>());
  const lastCommittedValueRef = useRef(value);
  const latestChangeRef = useRef(onDebouncedChange);
  const [localValue, setLocalValue] = useState(value);
  const [interactive, setInteractive] = useState(false);
  const localValueRef = useRef(value);
  const inputId = id ?? defaultId(queryKey);
  const clearPendingTimer = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
  }, []);
  const cancelPending = useCallback(() => {
    clearPendingTimer();
    pendingValueRef.current = undefined;
    ignoredControlledValuesRef.current.clear();
  }, [clearPendingTimer]);

  useEffect(() => {
    setInteractive(true);
  }, []);

  useEffect(() => {
    latestChangeRef.current = onDebouncedChange;
  }, [onDebouncedChange]);

  useImperativeHandle(ref, () => ({
    reset(nextValue = "") {
      cancelPending();
      lastCommittedValueRef.current = nextValue;
      localValueRef.current = nextValue;
      setLocalValue(nextValue);
    },
    cancelPending,
  }), [cancelPending]);

  useEffect(() => {
    // A router transition can render the old controlled value once before or
    // after the debounced callback. Keep the user's edit until the controlled
    // value acknowledges it. A late acknowledgement for any earlier request
    // must also be ignored while a newer edit is pending.
    const pendingValue = pendingValueRef.current;
    if (pendingValue !== undefined) {
      if (value === pendingValue && value === localValueRef.current) {
        clearPendingTimer();
        pendingValueRef.current = undefined;
        ignoredControlledValuesRef.current.clear();
        lastCommittedValueRef.current = value;
        return;
      }
      if (value === lastCommittedValueRef.current || ignoredControlledValuesRef.current.has(value)) return;
      cancelPending();
    }
    if (value === lastCommittedValueRef.current) return;
    lastCommittedValueRef.current = value;
    localValueRef.current = value;
    setLocalValue(value);
  }, [cancelPending, clearPendingTimer, value]);

  useEffect(() => {
    return cancelPending;
  }, [cancelPending]);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.value;
    localValueRef.current = nextValue;
    setLocalValue(nextValue);
    clearPendingTimer();
    pendingValueRef.current = nextValue;
    timerRef.current = setTimeout(() => {
      if (pendingValueRef.current !== nextValue) return;
      timerRef.current = undefined;
      ignoredControlledValuesRef.current.add(nextValue);
      if (ignoredControlledValuesRef.current.size > 8) {
        const oldest = ignoredControlledValuesRef.current.values().next().value;
        if (typeof oldest === "string") ignoredControlledValuesRef.current.delete(oldest);
      }
      latestChangeRef.current(nextValue);
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
        readOnly={!interactive}
        onChange={handleChange}
        placeholder={placeholder}
        className="min-w-0 max-w-full"
      />
    </div>
  );
});

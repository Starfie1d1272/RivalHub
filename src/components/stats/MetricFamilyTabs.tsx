"use client";
import React from "react";

export interface MetricFamilyOption<Key extends string = string> {
  key: Key;
  label: string;
}

export function MetricFamilyTabs<Key extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Key;
  options: readonly MetricFamilyOption<Key>[];
  onChange: (value: Key) => void;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs font-medium text-[var(--color-fg-mid)]">{label}</p>
      <div role="tablist" aria-label={label} className="flex min-w-0 gap-1 overflow-x-auto pb-1">
        {options.map((option) => (
          <button key={option.key} role="tab" aria-selected={value === option.key} type="button"
            onClick={() => onChange(option.key)} className={`whitespace-nowrap rounded-sm border px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] ${value === option.key ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-[var(--color-border)] hover:bg-[var(--color-surface-raised)]"}`}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

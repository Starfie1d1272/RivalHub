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
    <div role="tablist" aria-label={label} className="flex min-w-0 gap-1 overflow-x-auto border-b border-[var(--color-border)]">
      {options.map((option) => {
        const active = value === option.key;
        return (
          <button
            key={option.key}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(option.key)}
            className={[
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]",
              active
                ? "border-[var(--color-accent)] text-[var(--color-fg)]"
                : "border-transparent text-[var(--color-fg-mid)] hover:border-[var(--color-border-hi)] hover:text-[var(--color-fg)]",
            ].join(" ")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

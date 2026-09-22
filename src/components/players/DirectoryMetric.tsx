import React from "react";

export function DirectoryMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-[58px]">
      <p className="text-[10px] uppercase text-[var(--color-fg-dim)]" style={{ fontFamily: "var(--font-mono)" }}>
        {label}
      </p>
      <p className="mt-0.5 text-sm font-bold text-[var(--color-fg)] tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
        {value}
      </p>
    </div>
  );
}

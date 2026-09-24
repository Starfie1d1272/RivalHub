import type { ReactNode } from "react";

import { StatsMetricLabel } from "@/components/stats/StatsMetricHelp";

import type { StatsMetricKey } from "@/lib/stats/metrics";

export type MetricSectionItem = {
  label: string;
  value: ReactNode;
  metric?: StatsMetricKey;
};

export function MetricSection({ title, items, columns = 4 }: {
  title: string;
  items: MetricSectionItem[];
  columns?: 3 | 4 | 5 | 6;
}) {
  const gridClass = columns === 3
    ? "sm:grid-cols-3"
    : columns === 5
      ? "sm:grid-cols-5"
      : columns === 6
        ? "sm:grid-cols-3 lg:grid-cols-6"
        : "sm:grid-cols-4";

  return (
    <section className="border-t border-[var(--color-border)] pt-4">
      <h3 className="mb-4 text-sm font-semibold text-[var(--color-fg)]">{title}</h3>
      <dl className={["grid grid-cols-2 gap-x-5 gap-y-5", gridClass].join(" ")}>
        {items.map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="text-xs leading-5 text-[var(--color-fg-mid)]">
              {item.metric ? <StatsMetricLabel metric={item.metric}>{item.label}</StatsMetricLabel> : item.label}
            </dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--color-fg)]">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

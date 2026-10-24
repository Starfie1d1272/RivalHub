import { z } from "zod";
import type { Analysis } from "./analysis-model";
const count = z.number().int().nonnegative();
const value = z.number().finite().nonnegative();
const text = z.string().max(256);
const stats = {
  n: count,
  mean: value.nullable(),
  p50: value.nullable(),
  p75: value.nullable(),
  p95: value.nullable(),
  max: value.nullable(),
};
const dimension = z.object({ key: text, label: text, n: count, share: value });
const option = z.object({ value: text, label: text });
const filterKeys = [
  "hours",
  "scene",
  "role",
  "route",
  "device",
  "browser",
  "source",
  "release",
  "scope",
] as const;
const filters = z.object(
  Object.fromEntries(filterKeys.map((k) => [k, text])) as Record<
    (typeof filterKeys)[number],
    typeof text
  >,
);
export const AnalysisData: z.ZodType<Analysis> = z.object({
  filters,
  meta: z.object({
    capturedAt: count,
    from: count,
    oldest: count,
    batches: count,
    bytes: count,
    truncated: z.boolean(),
    validUntil: count,
    totalReports: count,
    uniqueEvents: count,
    selected: count,
    latest: count.nullable(),
    partial: z.boolean(),
  }),
  totals: z.object(
    Object.fromEntries(
      [
        "views",
        "sessions",
        "accounts",
        "filter",
        "starts",
        "success",
        "rejected",
        "unknown",
        "pending",
        "errors",
        "affectedSessions",
        "performance",
        "legacyPerformance",
        "clientCoverage",
        "clientCoveragePct",
        "outcomeCoveragePct",
        "resultOnly",
      ].map((k) => [k, value]),
    ) as Record<keyof Analysis["totals"], typeof value>,
  ),
  buckets: z
    .array(
      z.object({
        at: count,
        views: count,
        sessions: count,
        operations: count,
        filters: count,
        errors: count,
      }),
    )
    .max(169),
  routes: z
    .array(
      z.object({
        key: text,
        label: text,
        views: count,
        sessions: count,
        errors: count,
        share: value,
      }),
    )
    .max(200),
  distributions: z.object({
    device: z.array(dimension).max(10),
    browser: z.array(dimension).max(10),
    os: z.array(dimension).max(10),
    source: z.array(dimension).max(10),
    role: z.array(dimension).max(10),
    scene: z.array(dimension).max(10),
  }),
  metrics: z.array(z.object({ key: text, label: text, ...stats })).max(6),
  performanceRoutes: z
    .array(z.object({ route: text, label: text, metric: text, ...stats }))
    .max(1200),
  metricSegments: z
    .array(z.object({ metric: text, device: text, release: text, ...stats }))
    .max(12000),
  metricDevices: z
    .array(z.object({ metric: text, device: text, ...stats }))
    .max(60),
  histograms: z
    .array(
      z.object({
        metric: text,
        bounds: z.array(value).max(4),
        counts: z.array(count).max(5),
      }),
    )
    .max(6),
  operations: z
    .array(
      z.object({
        key: text,
        label: text,
        start: count,
        success: count,
        rejected: count,
        unknown: count,
        pending: count,
        completion: value,
        ...stats,
      }),
    )
    .max(300),
  variants: z
    .array(
      z.object({
        operation: text,
        label: text,
        variant: text,
        variantLabel: text,
        n: count,
      }),
    )
    .max(2000),
  filterRows: z
    .array(
      z.object({
        dimension: text,
        value: text,
        label: text,
        valueLabel: text,
        n: count,
        sessions: count,
      }),
    )
    .max(2000),
  navigation: z.array(dimension).max(4),
  errorGroups: z
    .array(
      z.object({
        key: z.string().max(768),
        type: text,
        route: text,
        label: text,
        operation: text,
        operationLabel: text,
        code: text,
        reason: text,
        n: count,
        sessions: count,
        last: count,
        details: z
          .array(
            z.object({
              at: count,
              session: text,
              sessionLabel: text,
              requestId: text.nullable(),
              role: text,
              release: text,
            }),
          )
          .max(30),
      }),
    )
    .max(100),
  sessions: z
    .array(
      z.object({
        key: text,
        label: text,
        role: text,
        pages: count,
        actions: count,
        errors: count,
        first: count,
        last: count,
      }),
    )
    .max(100),
  timeline: z
    .array(
      z.object({
        at: count,
        label: text,
        kind: text,
        phase: text,
        route: text,
        detail: z.string().max(4096),
        duration: value.nullable(),
        requestId: text.nullable(),
      }),
    )
    .max(100),
  usage: z.object({
    budget: z.object({ batches: count, bytes: count }),
    usage: z
      .array(z.object({ day: text, batches: count, bytes: count }))
      .max(8),
    expiredBatches: count,
  }),
  options: z.object({
    scene: z.array(option).max(4),
    role: z.array(option).max(4),
    route: z.array(option).max(200),
    device: z.array(option).max(10),
    browser: z.array(option).max(10),
    source: z.array(option).max(10),
    release: z.array(option).max(2000),
  }),
});

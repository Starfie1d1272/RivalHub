import { z } from "zod";
import { CLIENT_CATEGORIES, ROLES, UUID } from "./protocol";
import { ROUTES } from "./routes";
import { OPERATIONS } from "./operations";
import { TASK_NAMES } from "./task-contract";

export const HISTORY_DAY = 86400000;
export const HISTORY_OFFSET = 8 * 3600000;
export const HISTORY_DURATION_BOUNDS = [50, 100, 200, 500, 1000, 2000, 4000, 8000, 16000, 30000, 60000, 120000, 300000, 900000, 1800000, 3600000] as const;
export const HISTORY_CLS_BOUNDS = [0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1, 2, 5, 10, 100] as const;
export const historyFields = ["days", "scene", "role", "route", "device", "release", "eventId", "task", "operation"] as const;
export type HistoryQuery = Record<(typeof historyFields)[number], string>;
export const historyDefaults: HistoryQuery = { days: "28", scene: "", role: "", route: "", device: "", release: "", eventId: "", task: "", operation: "" };
export function parseHistoryQuery(input: unknown): HistoryQuery | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const p = input as Record<string, unknown>;
  if (Object.keys(p).some(k => !(historyFields as readonly string[]).includes(k)) || Object.values(p).some(v => typeof v !== "string")) return null;
  const f = { ...historyDefaults, ...p } as HistoryQuery;
  if (!["7", "28", "90"].includes(f.days) || !["", "major", "rivals", "other", "site"].includes(f.scene) || !["", ...ROLES].includes(f.role)) return null;
  if (f.route && !["/unknown", ...ROUTES].includes(f.route)) return null;
  if (f.device && !["missing", ...CLIENT_CATEGORIES.device].includes(f.device)) return null;
  if (!/^[A-Za-z0-9._-]{0,80}$/.test(f.release) || (f.eventId && !UUID.test(f.eventId))) return null;
  if (f.task && !(TASK_NAMES as readonly string[]).includes(f.task)) return null;
  if (f.operation && !(OPERATIONS as readonly string[]).includes(f.operation)) return null;
  return f;
}
const count = z.number().int().nonnegative();
const value = z.number().finite().nonnegative();
const text = z.string().max(160);
const distribution = z.object({ n: count, sum: value, min: value.nullable(), max: value.nullable(), counts: z.array(count).max(HISTORY_DURATION_BOUNDS.length + 1) });
export const HistoryRow = z.object({
  kind: z.enum(["page", "filter", "error", "operation", "performance", "ready", "task"]), name: text, task: text,
  route: text, scene: text, role: text, device: text, release: text, eventId: text, phase: text,
  measurementVersion: count.max(1), definitionVersion: count.max(2), navigationType: text, basis: text.optional(), elapsedCensored: z.boolean().optional(), activeCensored: z.boolean().optional(),
  n: count, starts: count, clientCovered: count, enhancedCovered: count,
  duration: distribution, active: distribution,
});
export type HistoryRow = z.infer<typeof HistoryRow>;
export const historyCountFields = ["views", "operations", "success", "rejected", "unknown", "pending", "taskStarts", "taskComplete", "taskExposure", "errors"] as const;
const historyCounts = z.object({ views: count, operations: count, success: count, rejected: count, unknown: count, pending: count, taskStarts: count, taskComplete: count, taskExposure: count, errors: count });
export const HistoryTimingRow = HistoryRow.pick({ kind: true, name: true, phase: true, release: true, measurementVersion: true, definitionVersion: true, navigationType: true, basis: true, elapsedCensored: true, activeCensored: true, duration: true, active: true }).extend({ reports: count.optional() });
export type HistoryTimingRow = z.infer<typeof HistoryTimingRow>;
export const HistoryData = z.object({
  validUntil: count.optional(), enabled: z.boolean(), retentionDays: count.max(90), generatedAt: count, coverageStart: count.nullable(), processedThrough: count.nullable(),
  coverage: z.object({ from: count, to: count, tailBatches: count, tailBytes: count, tailTruncated: z.boolean(),
    summaryComplete: z.boolean(), timingRowsTruncated: z.boolean(), unavailable: z.array(z.string()).max(10), timeZone: z.literal("Asia/Shanghai") }).optional(),
  pendingBatches: count, truncated: z.boolean(), correctionDays: z.literal(6),
  days: z.array(historyCounts.extend({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), complete: z.boolean(), sealed: z.boolean() })).max(90),
  timingRows: z.array(HistoryTimingRow).max(512),
});
export type HistoryData = z.infer<typeof HistoryData>;
export function historyDay(at: number) { return new Date(at + HISTORY_OFFSET).toISOString().slice(0, 10); }
export function historyDayStart(day: string) { return Date.parse(day + "T00:00:00+08:00"); }
export function historyBounds(metric: string) { return metric === "CLS" ? HISTORY_CLS_BOUNDS : HISTORY_DURATION_BOUNDS; }
export function emptyHistoryDistribution(metric = "") {
  return { n: 0, sum: 0, min: null as number | null, max: null as number | null, counts: Array<number>(historyBounds(metric).length + 1).fill(0) };
}
/** Returns the upper bound of the merged bucket; no averaging daily percentiles. */
export function historyQuantile(distribution: HistoryRow["duration"], q: number, metric = "") {
  if (!distribution.n || !(q > 0 && q <= 1)) return null;
  const rank = Math.ceil(distribution.n * q); let n = 0;
  const bounds = historyBounds(metric);
  for (let i = 0; i < distribution.counts.length; i++) {
    n += distribution.counts[i];
    if (n >= rank) return Math.min(bounds[i] ?? distribution.max ?? 0, distribution.max ?? Infinity);
  }
  return null;
}
export function mergeHistoryDistributions(rows: HistoryRow["duration"][], metric = "") {
  const result = emptyHistoryDistribution(metric);
  for (const row of rows) {
    result.n += row.n; result.sum += row.sum;
    if (row.min !== null) result.min = result.min === null ? row.min : Math.min(result.min, row.min);
    if (row.max !== null) result.max = result.max === null ? row.max : Math.max(result.max, row.max);
    row.counts.forEach((n, i) => { result.counts[i] = (result.counts[i] ?? 0) + n; });
  }
  return result;
}
export function summarizeHistory(data: HistoryData) {
  const totals = { views: 0, operations: 0, success: 0, rejected: 0, unknown: 0, pending: 0, taskStarts: 0, taskComplete: 0, taskExposure: 0, errors: 0 };
  for (const day of data.days) for (const key of historyCountFields) totals[key] += day[key];
  return { totals, byDay: data.days, timings: data.timingRows.map(row => ({
    kind: row.kind, name: row.name, phase: row.phase, release: row.release,
    measurementVersion: row.measurementVersion, definitionVersion: row.definitionVersion, navigationType: row.navigationType, basis: row.basis, elapsedCensored: row.elapsedCensored, activeCensored: row.activeCensored, reports: row.reports,
    n: row.duration.n, mean: row.duration.n ? row.duration.sum / row.duration.n : null,
    p50: historyQuantile(row.duration, .5, row.name), p90: historyQuantile(row.duration, .9, row.name),
    distribution: row.duration, active: row.active,
  })) };
}

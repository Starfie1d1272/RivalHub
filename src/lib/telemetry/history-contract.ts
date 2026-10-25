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
  if (!["28", "90"].includes(f.days) || !["", "major", "rivals", "other", "site"].includes(f.scene) || !["", ...ROLES].includes(f.role)) return null;
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
  measurementVersion: count.max(1), definitionVersion: count.max(1), navigationType: text,
  n: count, starts: count, clientCovered: count, enhancedCovered: count,
  duration: distribution, active: distribution,
});
export type HistoryRow = z.infer<typeof HistoryRow>;
export const HistoryData = z.object({
  enabled: z.boolean(), retentionDays: count.max(90), generatedAt: count, coverageStart: count.nullable(), processedThrough: count.nullable(),
  pendingBatches: count, truncated: z.boolean(), correctionDays: z.literal(6),
  days: z.array(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), complete: z.boolean(), sealed: z.boolean(), rows: z.array(HistoryRow).max(500) })).max(90),
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
  const byDay = data.days.map(day => {
    const point = { day: day.day, complete: day.complete, sealed: day.sealed, views: 0, operations: 0, success: 0, rejected: 0, unknown: 0, pending: 0, taskStarts: 0, taskComplete: 0, taskExposure: 0, errors: 0 };
    for (const row of day.rows) {
      if (row.kind === "page") point.views += row.n;
      if (row.kind === "error") point.errors += row.n;
      if (row.kind === "operation") {
        point.operations += row.starts;
        if (row.phase === "success") point.success += row.starts;
        else if (row.phase === "rejected") point.rejected += row.starts;
        else if (row.phase === "unknown") point.unknown += row.starts;
        else point.pending += row.starts;
      }
      if (row.kind === "task") { point.taskStarts += row.starts; if (row.phase === "complete") point.taskComplete += row.starts; if (row.phase === "exposure") point.taskExposure += row.n; }
    }
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += point[key];
    return point;
  });
  const groups = new Map<string, { kind: HistoryRow["kind"]; name: string; phase: string; measurementVersion: number; definitionVersion: number; navigationType: string; n: number; distributions: HistoryRow["duration"][] }>();
  for (const day of data.days) for (const row of day.rows) {
    if (!row.duration.n) continue;
    const key = `${row.kind}:${row.name}:${row.phase}:${row.measurementVersion}:${row.definitionVersion}:${row.navigationType}`;
    const group = groups.get(key) ?? { kind: row.kind, name: row.name, phase: row.phase, measurementVersion: row.measurementVersion, definitionVersion: row.definitionVersion, navigationType: row.navigationType, n: 0, distributions: [] };
    group.n += row.n; group.distributions.push(row.duration); groups.set(key, group);
  }
  return { totals, byDay, timings: [...groups.values()].map(g => {
    const distribution = mergeHistoryDistributions(g.distributions, g.name);
    return { kind: g.kind, name: g.name, phase: g.phase, measurementVersion: g.measurementVersion, definitionVersion: g.definitionVersion, navigationType: g.navigationType, n: distribution.n, mean: distribution.n ? distribution.sum / distribution.n : null, p50: historyQuantile(distribution, .5, g.name), p90: historyQuantile(distribution, .9, g.name), distribution };
  }) };
}

import type { DashboardData } from "../../src/lib/telemetry/dashboard-contract";
import { DASHBOARD_BATCH_LIMIT, type DashboardFilters } from "../../src/lib/telemetry/dashboard-query";
import type { Database } from "./index";

const HOUR = 3600000;
const METRICS = new Set(["TTFB", "FCP", "LCP", "INP", "NAV_COMMIT", "CLS"]);

/** Bounded summaries only; raw identity and compressed events never leave this read model. */
export async function dashboard(db: Database, filters: DashboardFilters, now: number, budget: DashboardData["budget"]): Promise<DashboardData> {
  const from = now - Number(filters.hours) * HOUR;
  const rows = await db.prepare(`SELECT received,expires,summary FROM batches
    WHERE expires>? AND received>=? AND environment='production' AND (?='' OR release=?)
    ORDER BY expires DESC,ticket DESC,id DESC LIMIT ?`)
    .bind(now, from, filters.release, filters.release, DASHBOARD_BATCH_LIMIT + 1)
    .all<{ received: number; expires: number; summary: string }>();
  const selected = rows.results.slice(0, DASHBOARD_BATCH_LIMIT);
  const totals = { page: 0, filter: 0, error: 0, start: 0, success: 0, rejected: 0, unknown: 0 };
  const trend = new Map<number, DashboardData["trend"][number]>();
  for (let at = Math.floor(from / HOUR) * HOUR; at <= now; at += HOUR) trend.set(at, { at, page: 0, start: 0, error: 0 });
  const routes = new Map<string, DashboardData["routes"][number]>();
  const operations = new Map<string, DashboardData["operations"][number]>();
  const clients = new Map<string, DashboardData["clients"][number]>();
  const performance = new Map<string, DashboardData["performance"][number]>();
  for (const batch of selected) {
    const bucket = trend.get(Math.floor(batch.received / HOUR) * HOUR)!;
    const summary = JSON.parse(batch.summary) as Array<[string, string, string, string, string, string, string, number, number, number | null | undefined, Record<string, string>?]>;
    for (const [, route, kind, operation, phase, , variant, n, duration, score, client] of summary) {
      if (filters.route && route !== filters.route) continue;
      if (kind === "page" || kind === "filter" || kind === "error") totals[kind] += n;
      const r = routes.get(route) ?? { route, pages: 0, errors: 0 };
      if (kind === "page") { r.pages += n; bucket.page += n; }
      if (kind === "error") { r.errors += n; bucket.error += n; }
      routes.set(route, r);
      if (kind === "page" && client) {
        for (const dimension of ["device", "browser", "os", "source"] as const) {
          const value = client[dimension];
          if (typeof value !== "string" || !/^[a-z_]{1,20}$/.test(value)) continue;
          const key = `${dimension}:${value}`;
          const c = clients.get(key) ?? { dimension, value, pages: 0 };
          c.pages += n; clients.set(key, c);
        }
      }
      if (kind === "operation") {
        const o = operations.get(operation) ?? { operation, start: 0, success: 0, rejected: 0, unknown: 0, durationMs: 0 };
        if (phase === "start" || phase === "success" || phase === "rejected" || phase === "unknown") {
          o[phase] += n; totals[phase] += n;
          if (phase === "start") bucket.start += n;
          else o.durationMs += duration;
        }
        operations.set(operation, o);
      }
      if (kind === "performance" && METRICS.has(variant)) {
        const key = `${route}:${variant}`;
        const p = performance.get(key) ?? { route, metric: variant as DashboardData["performance"][number]["metric"], reports: 0, durationMs: 0 };
        p.reports += n;
        if (variant === "CLS") p.score = (p.score ?? 0) + (score ?? 0);
        else p.durationMs += duration; performance.set(key, p);
      }
    }
  }
  const usage = await db.prepare("SELECT day,batches,bytes FROM usage ORDER BY day DESC LIMIT 8").all<DashboardData["usage"][number]>();
  const cleanup = await db.prepare("SELECT count(*) AS expiredBatches,min(expires) AS oldestExpiry FROM batches WHERE expires<=?").bind(now).first<DashboardData["cleanup"]>();
  return {
    generatedAt: now, validUntil: Math.min(now + 60000, ...selected.map(row => row.expires)), from, sampledBatches: selected.length, truncated: rows.results.length > DASHBOARD_BATCH_LIMIT,
    latestReceived: selected.length ? Math.max(...selected.map(row => row.received)) : null, totals,
    trend: [...trend.values()], routes: [...routes.values()].filter(r => r.pages || r.errors).sort((a, b) => b.pages - a.pages),
    operations: [...operations.values()].sort((a, b) => b.start - a.start),
    performance: [...performance.values()].sort((a, b) => b.durationMs / b.reports - a.durationMs / a.reports),
    clients: [...clients.values()].sort((a, b) => b.pages - a.pages),
    usage: usage.results, budget, cleanup: cleanup ?? { expiredBatches: 0, oldestExpiry: null },
  };
}

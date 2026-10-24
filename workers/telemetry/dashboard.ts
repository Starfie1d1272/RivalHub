import { CLIENT_CATEGORIES } from "../../src/lib/telemetry/client-context-contract";
import type { DashboardData } from "../../src/lib/telemetry/dashboard-contract";
import { DASHBOARD_BATCH_LIMIT, type DashboardFilters } from "../../src/lib/telemetry/dashboard-query";
import type { Database } from "./index";

const HOUR = 3600000;
const METRICS = new Set(["TTFB", "FCP", "LCP", "INP", "NAV_COMMIT", "CLS"]);
interface Group {
  at: number; route: string; kind: string; operation: string; phase: string; metric: string;
  n: number; duration: number; score: number | null;
  device: string | null; browser: string | null; os: string | null; source: string | null;
}

/** Aggregate in D1 so the receiver does not parse every batch summary on its CPU budget. */
export async function dashboard(db: Database, filters: DashboardFilters, now: number, budget: DashboardData["budget"]): Promise<DashboardData> {
  const from = now - Number(filters.hours) * HOUR;
  const sample = `SELECT received,expires,summary FROM batches WHERE expires>? AND received>=?
    AND environment='production' AND (?='' OR release=?) ORDER BY received DESC,ticket DESC,id DESC LIMIT ?`;
  const args = [now, from, filters.release, filters.release];
  const statements = [
    db.prepare(`SELECT count(*) AS batches,max(received) AS latestReceived,min(expires) AS earliestExpiry,
      min(CASE WHEN sample_rank<=${DASHBOARD_BATCH_LIMIT} THEN received END) AS earliestReceived
      FROM (SELECT received,expires,row_number() OVER (ORDER BY received DESC) AS sample_rank FROM (${sample}))`).bind(...args, DASHBOARD_BATCH_LIMIT + 1),
    db.prepare(`WITH expanded AS (
      SELECT cast(b.received/${HOUR} AS INTEGER)*${HOUR} AS at,
        json_extract(j.value,'$[1]') AS route,json_extract(j.value,'$[2]') AS kind,
        json_extract(j.value,'$[3]') AS operation,json_extract(j.value,'$[4]') AS phase,
        json_extract(j.value,'$[6]') AS metric,json_extract(j.value,'$[7]') AS n,
        json_extract(j.value,'$[8]') AS duration,json_extract(j.value,'$[9]') AS score,
        CASE WHEN json_extract(j.value,'$[2]')='page' THEN json_extract(j.value,'$[10].device') END AS device,
        CASE WHEN json_extract(j.value,'$[2]')='page' THEN json_extract(j.value,'$[10].browser') END AS browser,
        CASE WHEN json_extract(j.value,'$[2]')='page' THEN json_extract(j.value,'$[10].os') END AS os,
        CASE WHEN json_extract(j.value,'$[2]')='page' THEN json_extract(j.value,'$[10].source') END AS source
      FROM (${sample}) b,json_each(b.summary) j WHERE (?='' OR json_extract(j.value,'$[1]')=?)
        AND (json_extract(j.value,'$[2]')!='performance' OR json_extract(j.value,'$[6]')!='CLS'
          OR (json_type(j.value,'$[9]') IN ('integer','real') AND json_extract(j.value,'$[9]')>=0))
    ) SELECT at,route,kind,operation,phase,metric,device,browser,os,source,sum(n) AS n,
      sum(duration) AS duration,sum(score) AS score FROM expanded
      GROUP BY at,route,kind,operation,phase,metric,device,browser,os,source`)
      .bind(...args, DASHBOARD_BATCH_LIMIT, filters.route, filters.route),
    db.prepare("SELECT day,batches,bytes FROM usage ORDER BY day DESC LIMIT 8"),
    db.prepare("SELECT count(*) AS expiredBatches,min(expires) AS oldestExpiry FROM batches WHERE expires<=?").bind(now),
  ];
  const results = await db.batch(statements) as Array<{ results: unknown[] }>;
  const meta = results[0].results[0] as { batches: number; latestReceived: number | null; earliestExpiry: number | null; earliestReceived: number | null };
  const totals = { page: 0, filter: 0, error: 0, start: 0, success: 0, rejected: 0, unknown: 0 };
  const trend = new Map<number, DashboardData["trend"][number]>();
  const trendFrom = meta.batches > DASHBOARD_BATCH_LIMIT ? Math.max(from, meta.earliestReceived ?? from) : from;
  for (let at = Math.floor(trendFrom / HOUR) * HOUR; at <= now; at += HOUR) trend.set(at, { at, page: 0, start: 0, error: 0 });
  const routes = new Map<string, DashboardData["routes"][number]>();
  const operations = new Map<string, DashboardData["operations"][number]>();
  const clients = new Map<string, DashboardData["clients"][number]>();
  const performance = new Map<string, DashboardData["performance"][number]>();
  for (const group of results[1].results as Group[]) {
    const { at, route, kind, operation, phase, metric, n, duration, score } = group;
    const bucket = trend.get(at)!;
    if (kind === "page" || kind === "filter" || kind === "error") totals[kind] += n;
    const r = routes.get(route) ?? { route, pages: 0, errors: 0 };
    if (kind === "page") { r.pages += n; bucket.page += n; }
    if (kind === "error") { r.errors += n; bucket.error += n; }
    routes.set(route, r);
    if (kind === "page") for (const dimension of ["device", "browser", "os", "source"] as const) {
      const value = group[dimension];
      if (!value || !(CLIENT_CATEGORIES[dimension] as readonly string[]).includes(value)) continue;
      const key = `${dimension}:${value}`;
      const c = clients.get(key) ?? { dimension, value, pages: 0 };
      c.pages += n; clients.set(key, c);
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
    if (kind === "performance" && METRICS.has(metric)) {
      if (metric === "CLS" && (score === null || !Number.isFinite(score) || score < 0)) continue;
      const key = `${route}:${metric}`;
      const p = performance.get(key) ?? { route, metric: metric as DashboardData["performance"][number]["metric"], reports: 0, durationMs: 0 };
      p.reports += n;
      if (metric === "CLS") p.score = (p.score ?? 0) + score!;
      else p.durationMs += duration;
      performance.set(key, p);
    }
  }
  return {
    generatedAt: now, validUntil: Math.min(now + 60000, meta.earliestExpiry ?? now + 60000), from,
    sampledBatches: Math.min(meta.batches, DASHBOARD_BATCH_LIMIT), truncated: meta.batches > DASHBOARD_BATCH_LIMIT,
    latestReceived: meta.latestReceived, totals, trend: [...trend.values()],
    routes: [...routes.values()].filter(r => r.pages || r.errors).sort((a, b) => b.pages - a.pages),
    operations: [...operations.values()].sort((a, b) => b.start - a.start),
    performance: [...performance.values()].sort((a, b) => b.durationMs / b.reports - a.durationMs / a.reports),
    clients: [...clients.values()].sort((a, b) => b.pages - a.pages),
    usage: results[2].results as DashboardData["usage"], budget,
    cleanup: results[3].results[0] as DashboardData["cleanup"],
  };
}

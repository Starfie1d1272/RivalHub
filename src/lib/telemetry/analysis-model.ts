import {
  routeName,
  opName,
  cat,
  filterNames,
  filterValues,
  metricLabels,
} from "./analysis-presentation";
import {
  type AnalysisFilters as Filters,
  analysisDefaults as defaults,
} from "./analysis-query";
export interface EventRow {
  id: string;
  at: number;
  received: number;
  expires: number;
  session: string;
  account: string | null;
  role: string;
  release: string;
  route: string;
  scene: string;
  eventId: string | null;
  kind: string;
  phase?: string;
  operation?: string;
  operationId?: string | null;
  durationMs?: number;
  metricName?: string;
  score?: number;
  client?: Record<string, string>;
  navigation?: string;
  filters?: Record<string, string>;
  variant?: string;
  outcome?: string;
  errorCode?: string;
  requestId?: string;
}
export interface AnalysisSnapshot {
  capturedAt: number;
  batches: number;
  bytes: number;
  oldest: number;
  events: EventRow[];
  metricIds: string[];
  usage: {
    budget: { batches: number; bytes: number };
    usage: { day: string; batches: number; bytes: number }[];
    expiredBatches: number;
  };
  truncated: boolean;
  validUntil: number;
}
const uniq = (v: (string | null | undefined)[]) =>
  new Set(v.filter(Boolean)).size;
const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);
function quantile(xs: number[], q: number) {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)];
}
function stats(xs: number[]) {
  return {
    n: xs.length,
    mean: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null,
    p50: quantile(xs, 0.5),
    p75: quantile(xs, 0.75),
    p95: quantile(xs, 0.95),
    max: xs.length ? Math.max(...xs) : null,
  };
}
function groups<T>(rows: T[], key: (r: T) => string) {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const group = m.get(k);
    if (group) group.push(r);
    else m.set(k, [r]);
  }
  return [...m.entries()];
}
const opKey = (e: EventRow) =>
  `${e.account ?? ""}:${e.session}:${e.operationId}`;
function select(events: EventRow[], capturedAt: number, f: Filters) {
  const from = capturedAt - Number(f.hours) * 3600000;
  return events.filter(
    (e) =>
      e.received >= from &&
      e.received <= capturedAt &&
      (!f.scene || e.scene === f.scene) &&
      (!f.role || e.role === f.role) &&
      (!f.route || e.route === f.route) &&
      (!f.release || e.release === f.release) &&
      (!f.device || (e.client?.device ?? "missing") === f.device) &&
      (!f.browser || (e.client?.browser ?? "missing") === f.browser) &&
      (!f.source || (e.client?.source ?? "missing") === f.source) &&
      (!f.scope || e.route.startsWith("/admin") === (f.scope === "admin")),
  );
}
export function analyzeTelemetry(
  snapshot: AnalysisSnapshot,
  input: Filters,
  session = "",
) {
  const capturedAt = snapshot.capturedAt,
    all = snapshot.events,
    usage = snapshot.usage;
  const validMetricIds = new Set(snapshot.metricIds);
  const latest = new Map<string, EventRow>();
  for (const e of all) {
    const key = `${e.account ?? ""}:${e.session}:${e.kind === "performance" ? e.metricName : ""}:${e.id}`;
    const old = latest.get(key);
    if (
      !old ||
      e.at > old.at ||
      (e.at === old.at && e.received >= old.received)
    )
      latest.set(key, e);
  }
  const events = [...latest.values()];
  const completeOps = new Map(
    groups(
      events.filter((e) => e.kind === "operation" && e.operationId),
      opKey,
    ),
  );
  const sessionNames = new Map(
    [...new Set(events.map((e) => e.session))].map((s, i) => [
      s,
      `会话 ${String(i + 1).padStart(3, "0")}`,
    ]),
  );
  const f = { ...defaults, ...input };
  if (!["6", "24", "168"].includes(f.hours)) f.hours = "24";
  const rows = select(events, capturedAt, f);
  const pv = rows.filter((e) => e.kind === "page");
  const filter = rows.filter((e) => e.kind === "filter");
  const errors = rows.filter((e) => e.kind === "error");
  const unknown = rows.filter(
    (e) => e.kind === "operation" && e.phase === "unknown",
  );
  const rejects = rows.filter(
    (e) => e.kind === "operation" && e.phase === "rejected",
  );
  const starts = rows.filter(
    (e) => e.kind === "operation" && e.phase === "start",
  );
  const calls = starts.map((e) => {
    const results = (completeOps.get(opKey(e)) ?? [])
      .filter((x) => x.phase !== "start")
      .sort((a, b) => b.at - a.at);
    return { start: e, result: results[0] };
  });
  const phase = (s: string) =>
    calls.filter((c) => (c.result?.phase ?? "pending") === s).length;
  const from = capturedAt - Number(f.hours) * 3600000;
  const step = Number(f.hours) > 24 ? 86400000 : 3600000;
  const buckets = [];
  for (let at = Math.floor(from / step) * step; at <= capturedAt; at += step) {
    const rr = rows.filter((e) => e.received >= at && e.received < at + step);
    buckets.push({
      at,
      views: rr.filter((e) => e.kind === "page").length,
      sessions: uniq(rr.map((e) => e.session)),
      operations: rr.filter(
        (e) => e.kind === "operation" && e.phase === "start",
      ).length,
      filters: rr.filter((e) => e.kind === "filter").length,
      errors: rr.filter((e) => e.kind === "error" || e.phase === "unknown")
        .length,
    });
  }
  const routes = groups(rows, (e) => e.route)
    .map(([key, rr]) => ({
      key,
      label: routeName(key),
      views: rr.filter((e) => e.kind === "page").length,
      sessions: uniq(rr.map((e) => e.session)),
      errors: rr.filter((e) => e.kind === "error" || e.phase === "unknown")
        .length,
      share: pct(rr.filter((e) => e.kind === "page").length, pv.length),
    }))
    .sort((a, b) => b.views - a.views);
  const distributions = (dimension: string) =>
    groups(pv, (e) =>
      dimension === "role"
        ? e.role
        : dimension === "scene"
          ? e.scene
          : (e.client?.[dimension] ?? "missing"),
    )
      .map(([key, rr]) => ({
        key,
        label: cat(key),
        n: rr.length,
        share: pct(rr.length, pv.length),
      }))
      .sort((a, b) => b.n - a.n);
  const performance = rows.filter(
    (e) =>
      e.kind === "performance" &&
      validMetricIds.has(e.id) &&
      e.metricName &&
      (e.metricName === "CLS"
        ? typeof e.score === "number"
        : typeof e.durationMs === "number"),
  );
  const metricStats = (rr: EventRow[]) =>
    stats(rr.map((e) => (e.metricName === "CLS" ? e.score! : e.durationMs!)));
  const metrics = Object.keys(metricLabels).map((key) => ({
    key,
    label: metricLabels[key],
    ...metricStats(performance.filter((e) => e.metricName === key)),
  }));
  const performanceRoutes = groups(
    performance,
    (e) => `${e.route}|${e.metricName}`,
  ).map(([, rr]) => ({
    route: rr[0].route,
    label: routeName(rr[0].route),
    metric: rr[0].metricName!,
    ...metricStats(rr),
  }));
  const metricSegments = groups(
    performance,
    (e) => `${e.metricName}|${e.client?.device ?? "missing"}|${e.release}`,
  ).map(([, rr]) => ({
    metric: rr[0].metricName!,
    device: rr[0].client?.device ?? "missing",
    release: rr[0].release,
    ...metricStats(rr),
  }));
  const histograms = Object.keys(metricLabels).map((metric) => {
    const bounds =
      metric === "CLS"
        ? [0.05, 0.1, 0.25, 0.5]
        : metric === "INP"
          ? [100, 200, 500, 1000]
          : [500, 1500, 2500, 4000];
    const vals = performance
      .filter((e) => e.metricName === metric)
      .map((e) => (metric === "CLS" ? e.score! : e.durationMs!));
    return {
      metric,
      bounds,
      counts: bounds
        .map(
          (n, i) =>
            vals.filter((v) => v <= n && (i === 0 || v > bounds[i - 1])).length,
        )
        .concat(vals.filter((v) => v > bounds.at(-1)!).length),
    };
  });
  const operations = groups(calls, (c) => c.start.operation ?? "")
    .map(([key, cc]) => {
      const results = cc.filter((c) => c.result);
      const timings = results
        .map((c) => c.result!.durationMs)
        .filter((n): n is number => typeof n === "number");
      return {
        key,
        label: opName(key),
        start: cc.length,
        success: cc.filter((c) => c.result?.phase === "success").length,
        rejected: cc.filter((c) => c.result?.phase === "rejected").length,
        unknown: cc.filter((c) => c.result?.phase === "unknown").length,
        pending: cc.filter((c) => !c.result).length,
        completion: pct(results.length, cc.length),
        ...stats(timings),
      };
    })
    .sort((a, b) => b.start - a.start);
  const variants = groups(starts, (e) => `${e.operation}|${e.variant ?? ""}`)
    .map(([, rr]) => ({
      operation: rr[0].operation!,
      label: opName(rr[0].operation!),
      variant: rr[0].variant ?? "",
      variantLabel: rr[0].variant ? cat(rr[0].variant) : "未细分",
      n: rr.length,
    }))
    .sort((a, b) => b.n - a.n);
  const filterRows = groups(
    filter.flatMap((e) =>
      Object.entries(e.filters ?? {}).map(([dimension, value]) => ({
        dimension,
        value,
        session: e.session,
      })),
    ),
    (r) => `${r.dimension}|${r.value}`,
  )
    .map(([, rr]) => ({
      dimension: rr[0].dimension,
      value: rr[0].value,
      label: filterNames[rr[0].dimension] ?? "其他筛选",
      valueLabel: filterValues[rr[0].value] ?? "其他选项",
      n: rr.length,
      sessions: uniq(rr.map((e) => e.session)),
    }))
    .sort((a, b) => b.n - a.n);
  const errorGroups = groups(
    [...errors, ...unknown, ...rejects],
    (e) =>
      `${e.kind === "error" ? "client" : e.phase === "rejected" ? "rejected" : "unknown"}|${e.route}|${e.operation ?? ""}|${e.errorCode ?? ""}`,
  )
    .map(([key, rr]) => ({
      key,
      type:
        rr[0].kind === "error"
          ? "client"
          : rr[0].phase === "rejected"
            ? "rejected"
            : "unknown",
      route: rr[0].route,
      label: routeName(rr[0].route),
      operation: rr[0].operation ?? "",
      operationLabel: rr[0].operation ? opName(rr[0].operation) : "页面运行",
      code: rr[0].errorCode ?? "",
      reason: rr[0].errorCode ? cat(rr[0].errorCode) : "未提供错误分类",
      n: rr.length,
      sessions: uniq(rr.map((e) => e.session)),
      last: Math.max(...rr.map((e) => e.at)),
      details: rr
        .slice()
        .sort((a, b) => b.at - a.at)
        .slice(0, 30)
        .map((e) => ({
          at: e.at,
          session: e.session,
          sessionLabel: sessionNames.get(e.session)!,
          requestId: e.requestId ?? null,
          role: cat(e.role),
          release: e.release,
        })),
    }))
    .sort((a, b) => b.n - a.n);
  const sessions = groups(rows, (e) => e.session)
    .map(([key, rr]) => ({
      key,
      label: sessionNames.get(key)!,
      role: cat(rr[0].role),
      pages: rr.filter((e) => e.kind === "page").length,
      actions: rr.filter((e) => e.kind === "operation" && e.phase === "start")
        .length,
      errors: rr.filter((e) => e.kind === "error" || e.phase === "unknown")
        .length,
      first: Math.min(...rr.map((e) => e.at)),
      last: Math.max(...rr.map((e) => e.at)),
    }))
    .sort((a, b) => b.last - a.last);
  const timeline = rows
    .filter((e) => e.session === session && e.kind !== "performance")
    .sort((a, b) => a.at - b.at)
    .slice(0, 100)
    .map((e) => ({
      at: e.at,
      label:
        e.kind === "page"
          ? routeName(e.route)
          : e.kind === "filter"
            ? "调整页面筛选"
            : e.kind === "error"
              ? "客户端异常"
              : opName(e.operation ?? ""),
      kind: e.kind,
      phase: e.phase === "unknown" ? "结果未知" : e.phase ? cat(e.phase) : "",
      route: routeName(e.route),
      detail:
        e.kind === "page"
          ? cat(e.navigation ?? "missing")
          : e.kind === "filter"
            ? Object.entries(e.filters ?? {})
                .map(
                  ([k, v]) =>
                    `${filterNames[k] ?? "筛选"}：${filterValues[v] ?? "已使用"}`,
                )
                .join(" · ")
            : e.errorCode
              ? cat(e.errorCode)
              : "",
      duration: e.durationMs ?? null,
      requestId: e.requestId ?? null,
    }));
  const option = (values: string[], label: (v: string) => string) =>
    [...new Set(values)]
      .sort()
      .map((value) => ({ value, label: label(value) }));
  return {
    filters: f,
    meta: {
      capturedAt,
      from,
      oldest: snapshot.oldest,
      batches: snapshot.batches,
      bytes: snapshot.bytes,
      truncated: snapshot.truncated,
      validUntil: snapshot.validUntil,
      totalReports: all.length,
      uniqueEvents: events.length,
      selected: rows.length,
      latest: rows.length ? Math.max(...rows.map((e) => e.received)) : null,
      partial: from < snapshot.oldest,
    },
    totals: {
      views: pv.length,
      sessions: uniq(rows.map((e) => e.session)),
      accounts: uniq(rows.map((e) => e.account)),
      filter: filter.length,
      starts: starts.length,
      success: phase("success"),
      rejected: phase("rejected"),
      unknown: phase("unknown"),
      pending: phase("pending"),
      outcomeCoveragePct: pct(starts.length - phase("pending"), starts.length),
      errors: errors.length,
      affectedSessions: uniq([...errors, ...unknown].map((e) => e.session)),
      performance: performance.length,
      legacyPerformance: rows.filter(
        (e) => e.kind === "performance" && !validMetricIds.has(e.id),
      ).length,
      clientCoverage: pv.filter((e) => e.client).length,
      clientCoveragePct: pct(pv.filter((e) => e.client).length, pv.length),
      resultOnly: rows.filter(
        (e) =>
          e.kind === "operation" &&
          e.phase !== "start" &&
          !starts.some((s) => opKey(s) === opKey(e)),
      ).length,
    },
    buckets,
    routes,
    distributions: {
      device: distributions("device"),
      browser: distributions("browser"),
      os: distributions("os"),
      source: distributions("source"),
      role: distributions("role"),
      scene: distributions("scene"),
    },
    metrics,
    performanceRoutes,
    metricSegments,
    metricDevices: groups(
      performance,
      (e) => `${e.metricName}|${e.client?.device ?? "missing"}`,
    ).map(([, rr]) => ({
      metric: rr[0].metricName!,
      device: rr[0].client?.device ?? "missing",
      ...metricStats(rr),
    })),
    histograms,
    operations,
    variants,
    filterRows,
    navigation: groups(pv, (e) => e.navigation ?? "missing").map(
      ([key, rr]) => ({
        key,
        label: cat(key),
        n: rr.length,
        share: pct(rr.length, pv.length),
      }),
    ),
    errorGroups: errorGroups.slice(0, 100),
    sessions: sessions.slice(0, 100),
    timeline,
    usage,
    options: {
      scene: option(
        events.map((e) => e.scene),
        cat,
      ),
      role: option(
        events.map((e) => e.role),
        cat,
      ),
      route: option(
        events.map((e) => e.route),
        routeName,
      ),
      device: option(
        events.map((e) => e.client?.device ?? "missing"),
        cat,
      ),
      browser: option(
        events.map((e) => e.client?.browser ?? "missing"),
        cat,
      ),
      source: option(
        events.map((e) => e.client?.source ?? "missing"),
        cat,
      ),
      release: option(
        events.map((e) => e.release),
        (v) => "版本 " + v.slice(0, 7),
      ),
    },
  };
}
export type Analysis = ReturnType<typeof analyzeTelemetry>;

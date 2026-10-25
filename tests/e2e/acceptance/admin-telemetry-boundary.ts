import { analyzeTelemetry, type Analysis } from "../../../src/lib/telemetry/analysis-model";
import { analysisDefaults } from "../../../src/lib/telemetry/analysis-query";
import { AnalysisData } from "../../../src/lib/telemetry/analysis-contract";

/** Synthetic UI response-contract boundary, not a captured Worker/production response. */
export function telemetryBoundary() {
  const now = Date.now();
  const data: Analysis = analyzeTelemetry({ capturedAt: now, batches: 2000, bytes: 2097152,
    oldest: now - 168 * 3600000, events: [], metricIds: [], truncated: true, validUntil: now + 3600000,
    usage: { budget: { batches: 2000, bytes: 2097152 }, usage: [], expiredBatches: 0 } }, { ...analysisDefaults, hours: "168" });
  const keys = ["LCP", "FCP", "TTFB", "INP", "CLS", "NAV_COMMIT"];
  const stats = { n: 1, mean: 1, p50: 1, p75: 1, p95: 1, max: 1 };
  data.meta.selected = 20000; data.meta.uniqueEvents = 20000; data.meta.totalReports = 20000; data.meta.latest = now;
  data.totals.views = 20000; data.totals.performance = 12000; data.totals.errors = 100;
  data.metrics = keys.map(key => ({ key, label: key, ...stats }));
  data.routes = Array.from({ length: 200 }, (_, i) => ({ key: `/fixture/${i}`, label: `fixture ${i}`, views: 100, sessions: 1, errors: 0, share: 0.5 }));
  data.options.route = data.routes.map(r => ({ value: r.key, label: r.label }));
  data.options.release = Array.from({ length: 2000 }, (_, i) => ({ value: `fixture-${i}`, label: `fixture-${i}` }));
  data.operations = Array.from({ length: 300 }, (_, i) => ({ key: `fixture-${i}`, label: `fixture ${i}`, start: 1, success: 1, rejected: 0, unknown: 0, pending: 0, completion: 100, ...stats }));
  data.variants = Array.from({ length: 2000 }, (_, i) => ({ operation: `fixture-${i % 300}`, label: `fixture ${i}`, variant: `v${i}`, variantLabel: `v${i}`, n: 1 }));
  data.filterRows = Array.from({ length: 2000 }, (_, i) => ({ dimension: "route", value: `v${i}`, label: "route", valueLabel: `v${i}`, n: 1, sessions: 1 }));
  data.performanceRoutes = Array.from({ length: 1200 }, (_, i) => ({ route: `/fixture/${Math.floor(i / 6)}`, label: `fixture ${i}`, metric: keys[i % 6]!, ...stats }));
  data.errorGroups = Array.from({ length: 100 }, (_, i) => ({ key: `error-${i}`, type: "client", route: `/fixture/${i}`, label: `fixture ${i}`, operation: "", operationLabel: "", code: "CLIENT_UNHANDLED", reason: "fixture", n: 1, sessions: 1, last: now, details: [] }));
  data.sessions = Array.from({ length: 100 }, (_, i) => ({ key: i.toString(16).padStart(32, "0"), label: `session ${i}`, role: "user", pages: 1, actions: 1, errors: 0, first: now, last: now }));
  data.timeline = Array.from({ length: 100 }, (_, i) => ({ at: now, label: `fixture ${i}`, kind: "page", phase: "", route: "/", detail: "fixture", duration: null, requestId: null }));
  data.metricSegments = [];
  const size = () => Buffer.byteLength(JSON.stringify(data));
  const segment = (i: number) => ({ metric: keys[i % 6]!, device: "desktop", release: `fixture-${Math.floor(i / 6)}`, ...stats });
  // A valid response cannot simultaneously saturate all array caps: the server
  // enforces an earlier 1 MiB transport cap. Fill the remaining budget with rows.
  let used = size();
  for (let i = 0; i < 12000; i++) {
    const row = segment(i);
    const delta = Buffer.byteLength(JSON.stringify(row)) + (i > 0 ? 1 : 0);
    if (used + delta > 1048576) break;
    data.metricSegments.push(row); used += delta;
  }
  const remainder = 1048576 - used;
  if (remainder < 0 || remainder > 4000) throw new Error("Unexpected response boundary remainder");
  data.timeline[0]!.detail += "x".repeat(remainder);
  const parsed = AnalysisData.parse(data);
  const body = JSON.stringify(parsed);
  if (Buffer.byteLength(body) !== 1048576) throw new Error("Boundary must be exactly 1 MiB");
  return { body, data: parsed };
}

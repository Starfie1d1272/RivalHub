import type { Env } from "./index";

const HOUR = 3600000;
const CHUNK = 32;
const MAX_SHAPES = 90;
type Metric = { source: string; template: string; queries: number; failures: number; rows: number; queryMs: number };
type Source = { source: string; queries: number; failures: number; rows: number; queryMs: number; unsupported: number; overflow: number };
type Release = { release: string; deployment: string; processes: string[]; batches: number; queries: number; rows: number; receivedBytes: number };
type Rollup = { sources: Source[]; shapes: Metric[]; releases: Release[]; receivedBytes: number; connections: number; observedConnections: number; dropped: number; truncated: boolean };
type Batch = { id: string; at: number; process: string; release: string; deployment: string; payload: string; received_bytes: number; connections: number; observed_connections: number; dropped: number };
function empty(): Rollup { return { sources: [], shapes: [], releases: [], receivedBytes: 0, connections: 0, observedConnections: 0, dropped: 0, truncated: false }; }
function addMetric(target: Metric, row: Metric) { target.queries += row.queries; target.failures += row.failures; target.rows += row.rows; target.queryMs += row.queryMs; }
function incorporate(value: Rollup, batches: Batch[]): Rollup {
  const shapes = new Map(value.shapes.map(row => [`${row.source}:${row.template}`, row]));
  const sources = new Map(value.sources.map(row => [row.source, row]));
  const releases = new Map(value.releases.map(row => [`${row.release}:${row.deployment}`, row]));
  for (const batch of batches) {
    value.receivedBytes += batch.received_bytes; value.connections += batch.connections; value.observedConnections += batch.observed_connections; value.dropped += batch.dropped;
    let releaseKey = `${batch.release}:${batch.deployment}`;
    if (!releases.has(releaseKey) && releases.size >= 7) { releaseKey = "other:other"; value.truncated = true; }
    const release = releases.get(releaseKey) ?? { release: releaseKey === "other:other" ? "other" : batch.release, deployment: releaseKey === "other:other" ? "other" : batch.deployment, processes: [], batches: 0, queries: 0, rows: 0, receivedBytes: 0 };
    if (!release.processes.includes(batch.process)) { if (release.processes.length < 32) release.processes.push(batch.process); else value.truncated = true; }
    release.batches++; release.receivedBytes += batch.received_bytes;
    for (const row of JSON.parse(batch.payload) as Metric[]) {
      const source = sources.get(row.source) ?? { source: row.source, queries: 0, failures: 0, rows: 0, queryMs: 0, unsupported: 0, overflow: 0 };
      source.queries += row.queries; source.failures += row.failures; source.rows += row.rows; source.queryMs += row.queryMs;
      if (row.template === "unsupported") source.unsupported += row.queries;
      if (row.template === "overflow") source.overflow += row.queries;
      sources.set(row.source, source); release.queries += row.queries; release.rows += row.rows;
      const key = `${row.source}:${row.template}`;
      const shape = shapes.get(key) ?? { source: row.source, template: row.template, queries: 0, failures: 0, rows: 0, queryMs: 0 };
      addMetric(shape, row); shapes.set(key, shape);
    }
    releases.set(releaseKey, release);
  }
  if (shapes.size > MAX_SHAPES) {
    value.truncated = true;
    // Keep the leaders of all three metrics. Dropped shapes stay visible in exact source totals.
    const all = [...shapes.values()]; const keep = new Set<string>();
    for (const field of ["queries", "queryMs", "rows"] as const) {
      for (const row of [...all].sort((a, b) => b[field] - a[field]).slice(0, MAX_SHAPES / 3)) keep.add(`${row.source}:${row.template}`);
    }
    value.shapes = all.filter(row => keep.has(`${row.source}:${row.template}`));
  } else value.shapes = [...shapes.values()];
  value.sources = [...sources.values()]; value.releases = [...releases.values()];
  return value;
}

/** At most 128 batches per hourly invocation. CAS and processed flags commit atomically. */
export async function maintainDbTraffic(env: Env, now: number, maxChunks = 4) {
  for (let i = 0; i < maxChunks; i++) {
    const first = await env.DB.prepare("SELECT at FROM db_traffic_batches WHERE processed=0 AND at>? AND at<=? ORDER BY at,id LIMIT 1").bind(now - 7 * 86400000, now).first<{ at: number }>();
    if (!first) return;
    const hour = Math.floor(first.at / HOUR) * HOUR;
    // Read the version first: any concurrent consumer must advance it before
    // this selection can be committed. Expiry cleanup may instead delete rows,
    // so verify the complete selected set inside the same D1 transaction too.
    const stored = await env.DB.prepare("SELECT version,payload FROM db_traffic_hours WHERE hour=?").bind(hour).first<{ version: number; payload: string }>();
    const pending = await env.DB.prepare("SELECT id,at,process,release,deployment,payload,received_bytes,connections,observed_connections,dropped FROM db_traffic_batches WHERE processed=0 AND at>=? AND at<? AND at<=? ORDER BY at,id LIMIT ?").bind(hour, hour + HOUR, now, CHUNK).all<Batch>();
    if (!pending.results.length) return;
    const merged = incorporate(stored ? JSON.parse(stored.payload) as Rollup : empty(), pending.results);
    const version = stored?.version ?? 0;
    // Unary + keeps SQLite on the primary-key lookup rather than scanning the pending index.
    const ids = JSON.stringify(pending.results.map(row => row.id));
    const expected = pending.results.length;
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO db_traffic_hours(hour,version,payload,expires) SELECT ?,0,'{}',? WHERE ?=0 AND (SELECT count(*) FROM db_traffic_batches WHERE +processed=0 AND id IN (SELECT value FROM json_each(?)))=?").bind(hour, hour + 7 * 86400000, version, ids, expected),
      env.DB.prepare("UPDATE db_traffic_hours SET version=version+1,payload=? WHERE hour=? AND version=? AND (SELECT count(*) FROM db_traffic_batches WHERE +processed=0 AND id IN (SELECT value FROM json_each(?)))=?").bind(JSON.stringify(merged), hour, version, ids, expected),
      env.DB.prepare("UPDATE db_traffic_batches SET processed=1 WHERE +processed=0 AND id IN (SELECT value FROM json_each(?)) AND changes()=1").bind(ids),
    ]);
  }
}

/** Dashboard reads at most 73 bounded hour rows, never expands raw batch payloads in D1. */
export async function readDbTrafficHours(env: Env, now: number, hours: 24 | 72) {
  const start = Math.floor(now / HOUR) * HOUR - (hours - 1) * HOUR;
  const stored = await env.DB.prepare("SELECT hour,payload FROM db_traffic_hours WHERE hour>=? AND hour<=? AND expires>? ORDER BY hour DESC LIMIT 72").bind(start, now, now).all<{ hour: number; payload: string }>();
  const pending = await env.DB.prepare("SELECT count(*) AS n FROM (SELECT 1 FROM db_traffic_batches WHERE processed=0 AND at>=? AND at<=? LIMIT 513)").bind(start, now).first<{ n: number }>();
  const totals = new Map<string, Metric>(); const sources = new Map<string, Source>(); const hourly: Array<{ hour: number; release: string; deployment: string; batches: number; processes: number; queries: number; rows: number; receivedBytes: number }> = [];
  let dropped = 0, receivedBytes = 0, connections = 0, observedConnections = 0, truncated = false;
  for (const row of stored.results) {
    const value = JSON.parse(row.payload) as Rollup;
    dropped += value.dropped; receivedBytes += value.receivedBytes; connections += value.connections; observedConnections += value.observedConnections; truncated ||= value.truncated;
    for (const shape of value.shapes) { const key = `${shape.source}:${shape.template}`; const target = totals.get(key) ?? { ...shape, queries: 0, failures: 0, rows: 0, queryMs: 0 }; addMetric(target, shape); totals.set(key, target); }
    for (const source of value.sources) { const target = sources.get(source.source) ?? { source: source.source, queries: 0, failures: 0, rows: 0, queryMs: 0, unsupported: 0, overflow: 0 }; target.queries += source.queries; target.failures += source.failures; target.rows += source.rows; target.queryMs += source.queryMs; target.unsupported += source.unsupported; target.overflow += source.overflow; sources.set(source.source, target); }
    for (const release of value.releases) hourly.push({ hour: row.hour, release: release.release, deployment: release.deployment, batches: release.batches, processes: release.processes.length, queries: release.queries, rows: release.rows, receivedBytes: release.receivedBytes });
  }
  const all = [...totals.values()];
  const ranking = (field: "queries" | "queryMs" | "rows") => [...all].sort((a, b) => b[field] - a[field]).slice(0, 20);
  return { start, totals: ranking("queries"), byTime: ranking("queryMs"), byRows: ranking("rows"), sources: [...sources.values()].sort((a, b) => b.queries - a.queries), hours: hourly.slice(0, 1000), truncated: truncated || hourly.length > 1000, pending: pending?.n ?? 0, dropped, receivedBytes, connections, observedConnections };
}

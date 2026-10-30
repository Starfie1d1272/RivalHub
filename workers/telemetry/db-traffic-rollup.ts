import type { Env } from "./index";

const HOUR = 3600000;
const CHUNK = 32;
const MAX_SHAPES = 120;
type Metric = { source: string; template: string; queries: number; failures: number; rows: number; queryMs: number; logicalRowJsonBytes: number; logicalMeasuredQueries: number };
type Source = { source: string; queries: number; failures: number; rows: number; queryMs: number; unsupported: number; overflow: number; logicalRowJsonBytes: number; logicalMeasuredQueries: number };
type Release = { release: string; deployment: string; processes: string[]; batches: number; queries: number; rows: number; receivedBytes: number; logicalRowJsonBytes: number; logicalMeasuredQueries: number };
type SkipReasons = { budget: number; unsupported_value: number; error: number };
type Remaining = { async: number; no_owner: number; partial: number; unsupported: number; instrumentation: number };
type ScopedMetric = Metric & { rxBytes: number; skipReasons: SkipReasons; rxComplete: boolean; logicalComplete: boolean; skipReasonsComplete: boolean };
type ScopedSource = ScopedMetric & { unsupported: number; overflow: number };
type Loss = { droppedReceivedBytes: number; unconfirmedReceivedBytes: number; unconfirmedBatches: number; lossComplete: boolean };
type Scope = Loss & { release: string; deployment: string; processes: string[]; batches: number; queries: number; rows: number; receivedBytes: number; dropped: number; connections: number; observedConnections: number; remainingRxBytes: number; remaining: Remaining; rxComplete: boolean; logicalComplete: boolean; skipReasonsComplete: boolean; sources: ScopedSource[]; shapes: ScopedMetric[]; truncated: boolean };
type Rollup = Partial<Loss> & { scopes?: Scope[]; unscoped?: boolean; sources: Source[]; shapes: Metric[]; releases: Release[]; receivedBytes: number; connections: number; observedConnections: number; dropped: number; truncated: boolean };
type InputRow = Metric & { rxBytes?: number; skipReasons?: SkipReasons };
type BatchPayload = InputRow[] | { rows: InputRow[]; remainingRxBytes: number; remaining: Remaining; droppedReceivedBytes?: number; unconfirmedReceivedBytes?: number; unconfirmedBatches?: number };
type Batch = { id: string; at: number; process: string; release: string; deployment: string; payload: string; received_bytes: number; connections: number; observed_connections: number; dropped: number };
function empty(): Rollup { return { scopes: [], unscoped: false, droppedReceivedBytes: 0, unconfirmedReceivedBytes: 0, unconfirmedBatches: 0, lossComplete: true, sources: [], shapes: [], releases: [], receivedBytes: 0, connections: 0, observedConnections: 0, dropped: 0, truncated: false }; }
function addMetric(target: Metric, row: Metric) { target.queries += row.queries; target.failures += row.failures; target.rows += row.rows; target.queryMs += row.queryMs; target.logicalRowJsonBytes = (target.logicalRowJsonBytes ?? 0) + (row.logicalRowJsonBytes ?? 0); target.logicalMeasuredQueries = (target.logicalMeasuredQueries ?? 0) + (row.logicalMeasuredQueries ?? 0); }
const noReasons = (): SkipReasons => ({ budget: 0, unsupported_value: 0, error: 0 });
const noRemaining = (): Remaining => ({ async: 0, no_owner: 0, partial: 0, unsupported: 0, instrumentation: 0 });
function freshMetric(source: string, template: string): ScopedMetric {
  return { source, template, queries: 0, failures: 0, rows: 0, queryMs: 0, logicalRowJsonBytes: 0, logicalMeasuredQueries: 0, rxBytes: 0, skipReasons: noReasons(), rxComplete: true, logicalComplete: true, skipReasonsComplete: true };
}
function addScoped(target: ScopedMetric, row: InputRow) {
  addMetric(target, row);
  target.rxComplete &&= row.rxBytes !== undefined;
  target.logicalComplete &&= row.logicalMeasuredQueries !== undefined && row.logicalRowJsonBytes !== undefined;
  target.skipReasonsComplete &&= row.skipReasons !== undefined;
  target.rxBytes += row.rxBytes ?? 0;
  for (const key of ["budget", "unsupported_value", "error"] as const) target.skipReasons[key] += row.skipReasons?.[key] ?? 0;
}
/** Keep each version separate. Historical rollups without scoped data cannot be reconstructed. */
function incorporateScopes(value: Rollup, batches: Batch[]) {
  if (!value.scopes) { value.scopes = []; value.unscoped = true; }
  for (const batch of batches) {
    let scope = value.scopes.find(s => s.release === batch.release && s.deployment === batch.deployment);
    if (!scope) {
      if (value.scopes.length >= 7) { value.unscoped = true; value.truncated = true; continue; }
      scope = { release: batch.release, deployment: batch.deployment, droppedReceivedBytes: 0, unconfirmedReceivedBytes: 0, unconfirmedBatches: 0, lossComplete: true, processes: [], batches: 0, queries: 0, rows: 0, receivedBytes: 0, dropped: 0, connections: 0, observedConnections: 0, remainingRxBytes: 0, remaining: noRemaining(), rxComplete: true, logicalComplete: true, skipReasonsComplete: true, sources: [], shapes: [], truncated: false };
      value.scopes.push(scope);
    }
    if (!scope.processes.includes(batch.process)) { if (scope.processes.length < 32) scope.processes.push(batch.process); else scope.truncated = true; }
    scope.batches++; scope.receivedBytes += batch.received_bytes; scope.dropped += batch.dropped; scope.connections += batch.connections; scope.observedConnections += batch.observed_connections;
    const payload = JSON.parse(batch.payload) as BatchPayload;
    const rows = Array.isArray(payload) ? payload : payload.rows;
    if (Array.isArray(payload)) { scope.rxComplete = false; scope.skipReasonsComplete = false; scope.lossComplete = false; }
    else {
      scope.lossComplete &&= payload.droppedReceivedBytes !== undefined && payload.unconfirmedReceivedBytes !== undefined && payload.unconfirmedBatches !== undefined;
      scope.droppedReceivedBytes += payload.droppedReceivedBytes ?? 0; scope.unconfirmedReceivedBytes += payload.unconfirmedReceivedBytes ?? 0; scope.unconfirmedBatches += payload.unconfirmedBatches ?? 0;
      scope.remainingRxBytes += payload.remainingRxBytes;
      for (const key of ["async", "no_owner", "partial", "unsupported", "instrumentation"] as const) scope.remaining[key] += payload.remaining[key];
    }
    for (const row of rows) {
      scope.logicalComplete &&= row.logicalMeasuredQueries !== undefined && row.logicalRowJsonBytes !== undefined;
      scope.skipReasonsComplete &&= row.skipReasons !== undefined;
      let source = scope.sources.find(s => s.source === row.source);
      if (!source) { source = { ...freshMetric(row.source, ""), unsupported: 0, overflow: 0 }; scope.sources.push(source); }
      addScoped(source, row);
      if (row.template === "unsupported") source.unsupported += row.queries;
      if (row.template === "overflow") { source.overflow += row.queries; scope.truncated = true; }
      scope.queries += row.queries; scope.rows += row.rows;
      let shape = scope.shapes.find(s => s.source === row.source && s.template === row.template);
      if (!shape) { shape = freshMetric(row.source, row.template); scope.shapes.push(shape); }
      addScoped(shape, row);
    }
    if (scope.shapes.length > MAX_SHAPES) {
      scope.truncated = true;
      const keep = new Set<ScopedMetric>();
      for (const field of ["queries", "queryMs", "rows", "logicalRowJsonBytes", "rxBytes"] as const) {
        for (const shape of [...scope.shapes].sort((a, b) => b[field] - a[field]).slice(0, MAX_SHAPES / 5)) keep.add(shape);
      }
      scope.shapes = scope.shapes.filter(shape => keep.has(shape));
    }
  }
}
function incorporate(value: Rollup, batches: Batch[]): Rollup {
  if (value.lossComplete === undefined) value.lossComplete = false;
  value.droppedReceivedBytes ??= 0; value.unconfirmedReceivedBytes ??= 0; value.unconfirmedBatches ??= 0;
  for (const batch of batches) {
    const payload = JSON.parse(batch.payload) as BatchPayload;
    if (Array.isArray(payload) || payload.droppedReceivedBytes === undefined || payload.unconfirmedReceivedBytes === undefined || payload.unconfirmedBatches === undefined) value.lossComplete = false;
    else { value.droppedReceivedBytes += payload.droppedReceivedBytes; value.unconfirmedReceivedBytes += payload.unconfirmedReceivedBytes; value.unconfirmedBatches += payload.unconfirmedBatches; }
  }
  incorporateScopes(value, batches);
  const shapes = new Map(value.shapes.map(row => [`${row.source}:${row.template}`, row]));
  const sources = new Map(value.sources.map(row => [row.source, row]));
  const releases = new Map(value.releases.map(row => [`${row.release}:${row.deployment}`, row]));
  for (const batch of batches) {
    value.receivedBytes += batch.received_bytes; value.connections += batch.connections; value.observedConnections += batch.observed_connections; value.dropped += batch.dropped;
    let releaseKey = `${batch.release}:${batch.deployment}`;
    if (!releases.has(releaseKey) && releases.size >= 7) { releaseKey = "other:other"; value.truncated = true; }
    const release = releases.get(releaseKey) ?? { release: releaseKey === "other:other" ? "other" : batch.release, deployment: releaseKey === "other:other" ? "other" : batch.deployment, processes: [], batches: 0, queries: 0, rows: 0, receivedBytes: 0, logicalRowJsonBytes: 0, logicalMeasuredQueries: 0 };
    if (!release.processes.includes(batch.process)) { if (release.processes.length < 32) release.processes.push(batch.process); else value.truncated = true; }
    release.batches++; release.receivedBytes += batch.received_bytes;
    const payload = JSON.parse(batch.payload) as BatchPayload;
    for (const row of Array.isArray(payload) ? payload : payload.rows) {
      const source = sources.get(row.source) ?? { source: row.source, queries: 0, failures: 0, rows: 0, queryMs: 0, unsupported: 0, overflow: 0, logicalRowJsonBytes: 0, logicalMeasuredQueries: 0 };
      source.queries += row.queries; source.failures += row.failures; source.rows += row.rows; source.queryMs += row.queryMs; source.logicalRowJsonBytes = (source.logicalRowJsonBytes ?? 0) + (row.logicalRowJsonBytes ?? 0); source.logicalMeasuredQueries = (source.logicalMeasuredQueries ?? 0) + (row.logicalMeasuredQueries ?? 0);
      if (row.template === "unsupported") source.unsupported += row.queries;
      if (row.template === "overflow") { source.overflow += row.queries; value.truncated = true; }
      sources.set(row.source, source); release.queries += row.queries; release.rows += row.rows; release.logicalRowJsonBytes = (release.logicalRowJsonBytes ?? 0) + (row.logicalRowJsonBytes ?? 0); release.logicalMeasuredQueries = (release.logicalMeasuredQueries ?? 0) + (row.logicalMeasuredQueries ?? 0);
      const key = `${row.source}:${row.template}`;
      const shape = shapes.get(key) ?? { source: row.source, template: row.template, queries: 0, failures: 0, rows: 0, queryMs: 0, logicalRowJsonBytes: 0, logicalMeasuredQueries: 0 };
      addMetric(shape, row); shapes.set(key, shape);
    }
    releases.set(releaseKey, release);
  }
  if (shapes.size > MAX_SHAPES) {
    value.truncated = true;
    // Keep the leaders of all four metrics. Dropped shapes stay visible in exact source totals.
    const all = [...shapes.values()]; const keep = new Set<string>();
    for (const field of ["queries", "queryMs", "rows", "logicalRowJsonBytes"] as const) {
      for (const row of [...all].sort((a, b) => (b[field] ?? 0) - (a[field] ?? 0)).slice(0, MAX_SHAPES / 4)) keep.add(`${row.source}:${row.template}`);
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
export type TrafficSelection = { hour: number; release: string; deployment: string };
export async function readDbTrafficHours(env: Env, now: number, hours: 24 | 72, selection?: TrafficSelection) {
  const start = Math.floor(now / HOUR) * HOUR - (hours - 1) * HOUR;
  const stored = await env.DB.prepare("SELECT hour,payload FROM db_traffic_hours WHERE hour>=? AND hour<=? AND expires>? ORDER BY hour DESC LIMIT 72").bind(start, now, now).all<{ hour: number; payload: string }>();
  const pending = await env.DB.prepare("SELECT count(*) AS n FROM (SELECT 1 FROM db_traffic_batches WHERE processed=0 AND at>=? AND at<=? LIMIT 513)").bind(start, now).first<{ n: number }>();
  const windows: Array<Omit<Scope, "processes"> & { hour: number; processes: number; scopedComplete: boolean }> = [];
  const totals = new Map<string, Metric>(); const sources = new Map<string, Source>(); const hourly: Array<{ hour: number; release: string; deployment: string; batches: number; processes: number; queries: number; rows: number; receivedBytes: number; logicalRowJsonBytes: number; logicalMeasuredQueries: number }> = [];
  let dropped = 0, receivedBytes = 0, connections = 0, observedConnections = 0, truncated = false;
  let droppedReceivedBytes = 0, unconfirmedReceivedBytes = 0, unconfirmedBatches = 0, lossComplete = true;
  for (const row of stored.results) {
    const value = JSON.parse(row.payload) as Rollup;
    for (const scope of value.scopes ?? []) windows.push({ ...scope, hour: row.hour, processes: scope.processes.length, scopedComplete: !value.unscoped });
    droppedReceivedBytes += value.droppedReceivedBytes ?? 0; unconfirmedReceivedBytes += value.unconfirmedReceivedBytes ?? 0; unconfirmedBatches += value.unconfirmedBatches ?? 0; lossComplete &&= value.lossComplete === true;
    dropped += value.dropped; receivedBytes += value.receivedBytes; connections += value.connections; observedConnections += value.observedConnections; truncated ||= value.truncated;
    for (const shape of value.shapes) { const key = `${shape.source}:${shape.template}`; const target = totals.get(key) ?? { ...shape, queries: 0, failures: 0, rows: 0, queryMs: 0, logicalRowJsonBytes: 0, logicalMeasuredQueries: 0 }; addMetric(target, shape); totals.set(key, target); }
    for (const source of value.sources) { const target = sources.get(source.source) ?? { source: source.source, queries: 0, failures: 0, rows: 0, queryMs: 0, unsupported: 0, overflow: 0, logicalRowJsonBytes: 0, logicalMeasuredQueries: 0 }; target.queries += source.queries; target.failures += source.failures; target.rows += source.rows; target.queryMs += source.queryMs; target.unsupported += source.unsupported; target.overflow += source.overflow; target.logicalRowJsonBytes += source.logicalRowJsonBytes ?? 0; target.logicalMeasuredQueries += source.logicalMeasuredQueries ?? 0; sources.set(source.source, target); }
    for (const release of value.releases) hourly.push({ hour: row.hour, release: release.release, deployment: release.deployment, batches: release.batches, processes: release.processes.length, queries: release.queries, rows: release.rows, receivedBytes: release.receivedBytes, logicalRowJsonBytes: release.logicalRowJsonBytes ?? 0, logicalMeasuredQueries: release.logicalMeasuredQueries ?? 0 });
  }
  // Bound the dashboard response: only one selected window carries detailed rankings.
  // All other windows retain their metadata for navigation.
  const selected = windows.find(w => selection && w.hour === selection.hour && w.release === selection.release && w.deployment === selection.deployment) ?? windows[0];
  for (const window of windows) if (window !== selected) { window.sources = []; window.shapes = []; }
  const all = [...totals.values()];
  const ranking = (field: "queries" | "queryMs" | "rows" | "logicalRowJsonBytes") => [...all].sort((a, b) => (b[field] ?? 0) - (a[field] ?? 0)).slice(0, 20);
  return { start, windows, droppedReceivedBytes, unconfirmedReceivedBytes, unconfirmedBatches, lossComplete, unscopedHours: stored.results.filter(row => { const value = JSON.parse(row.payload) as Rollup; return !value.scopes || value.unscoped; }).map(row => row.hour), totals: ranking("queries"), byTime: ranking("queryMs"), byRows: ranking("rows"), byBytes: ranking("logicalRowJsonBytes"), sources: [...sources.values()].sort((a, b) => b.queries - a.queries), hours: hourly.slice(0, 1000), truncated: truncated || hourly.length > 1000, pending: pending?.n ?? 0, dropped, receivedBytes, connections, observedConnections };
}

/** Isolated quality evidence is counted separately and never contributes measured traffic. */
export async function maintainDbTrafficQuality(env: Env, now: number, maxChunks = 4) {
  for (let i = 0; i < maxChunks; i++) {
    const first = await env.DB.prepare("SELECT at FROM db_traffic_receipts WHERE status IN ('quarantined','gap') AND processed=0 AND at>? AND at<=? ORDER BY at,id LIMIT 1").bind(now - 7 * 86400000, now).first<{ at: number }>();
    if (!first) return;
    const hour = Math.floor(first.at / HOUR) * HOUR;
    const stored = await env.DB.prepare("SELECT version,payload FROM db_traffic_quality_hours WHERE hour=?").bind(hour).first<{ version: number; payload: string }>();
    const pending = await env.DB.prepare("SELECT id,release,deployment,reasons,status,payload FROM db_traffic_receipts WHERE status IN ('quarantined','gap') AND processed=0 AND at>=? AND at<? AND at<=? ORDER BY at,id LIMIT ?").bind(hour, hour + HOUR, now, CHUNK).all<{ id: string; release: string; deployment: string; reasons: string; status: string; payload: string }>();
    if (!pending.results.length) return;
    const value = stored ? JSON.parse(stored.payload) as { scopes: Array<{ release: string; deployment: string; batches: number; reasons: Record<string, number>; lostBatches?: number; unconfirmedBatches?: number; lostBytes?: number; unconfirmedBytes?: number; coverageUnknownSince?: number | null }>; truncated: boolean } : { scopes: [], truncated: false };
    for (const row of pending.results) {
      let scope = value.scopes.find(item => item.release === row.release && item.deployment === row.deployment);
      if (!scope) {
        if (value.scopes.length >= 32) { value.truncated = true; continue; }
        scope = { release: row.release, deployment: row.deployment, batches: 0, reasons: {} }; value.scopes.push(scope);
      }
      if (row.status === "gap") {
        const gap = JSON.parse(row.payload) as { certainty: string; batches: number; receivedBytes: number; truncated: boolean; coverageUnknownSince: number | null };
        if (gap.certainty === "lost") { scope.lostBatches = (scope.lostBatches ?? 0) + gap.batches; scope.lostBytes = (scope.lostBytes ?? 0) + gap.receivedBytes; }
        if (gap.certainty === "unconfirmed") { scope.unconfirmedBatches = (scope.unconfirmedBatches ?? 0) + gap.batches; scope.unconfirmedBytes = (scope.unconfirmedBytes ?? 0) + gap.receivedBytes; }
        if (gap.coverageUnknownSince !== null) scope.coverageUnknownSince = Math.min(scope.coverageUnknownSince ?? gap.coverageUnknownSince, gap.coverageUnknownSince);
        value.truncated ||= gap.truncated || gap.certainty === "unknown";
      } else scope.batches++;
      for (const reason of JSON.parse(row.reasons) as string[]) scope.reasons[reason] = (scope.reasons[reason] ?? 0) + 1;
    }
    const version = stored?.version ?? 0;
    const ids = JSON.stringify(pending.results.map(row => row.id));
    const expected = pending.results.length;
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO db_traffic_quality_hours(hour,version,payload,expires) SELECT ?,0,'{}',? WHERE ?=0 AND (SELECT count(*) FROM db_traffic_receipts WHERE status IN ('quarantined','gap') AND +processed=0 AND id IN (SELECT value FROM json_each(?)))=?").bind(hour, hour + 7 * 86400000, version, ids, expected),
      env.DB.prepare("UPDATE db_traffic_quality_hours SET version=version+1,payload=? WHERE hour=? AND version=? AND (SELECT count(*) FROM db_traffic_receipts WHERE status IN ('quarantined','gap') AND +processed=0 AND id IN (SELECT value FROM json_each(?)))=?").bind(JSON.stringify(value), hour, version, ids, expected),
      env.DB.prepare("UPDATE db_traffic_receipts SET processed=1 WHERE status IN ('quarantined','gap') AND +processed=0 AND id IN (SELECT value FROM json_each(?)) AND changes()=1").bind(ids),
    ]);
  }
}

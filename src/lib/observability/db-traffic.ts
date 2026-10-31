import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { writeSync } from "node:fs";
import { Agent, request } from "node:https";
import type { PoolClient } from "pg";
import { writeExitCapsule } from "./db-traffic-capsule";
import { observePgTraffic, settlePgTraffic } from "./pg-traffic-adapter";
import type { DbTrafficDelivery } from "./db-traffic-delivery";

import { DB_SOURCES, digestDbTraffic, isSafeDbTrafficBatch, type DbTrafficSource } from "./db-traffic-contract";
export { DB_SOURCES, type DbTrafficSource } from "./db-traffic-contract";
export type DbTemplate = string;
type Row = { source: DbTrafficSource; template: string; queries: number; failures: number; rows: number; queryMs: number; logicalRowJsonBytes: number; logicalMeasuredQueries: number; rxBytes: number; skipReasons: { budget: number; unsupported_value: number; error: number } };
type Context = { source: DbTrafficSource };
type State = { maintenance?: Promise<void>; initializing?: Promise<boolean>; initStartedAt?: number; earliestObservedAt?: number; degradedSince?: number; exitCapsuleArmed?: boolean; delivery?: Promise<DbTrafficDelivery>; deliveryStarted?: boolean; flushAgain?: boolean; diskNextAttemptAt?: number; coverageUnknownSince?: number; budgetStartedAt?: number; budgetSent?: number; sealing?: { body: string; rows: Row[]; receivedBytes: number; remaining: Remaining; at: number; capturedAt: number }; context: AsyncLocalStorage<Context>; rows: Map<string, Row>; shapeScores?: Map<string, number>; processId: string; sending: boolean; receivedBytes: number; connections: number; observedConnections: number; clients: Set<PoolClient>; hour: number; remaining: Remaining };
type Remaining = { async: number; no_owner: number; partial: number; unsupported: number; instrumentation: number };
function emptyRemaining(): Remaining { return { async: 0, no_owner: 0, partial: 0, unsupported: 0, instrumentation: 0 }; }
const HOUR = 3600000;
const slot = Symbol.for("rivalhub.db-traffic.v3");
function state(): State {
  const host = process as unknown as Record<symbol, State | undefined>;
  return host[slot] ??= { context: new AsyncLocalStorage(), rows: new Map(), processId: crypto.randomUUID(), sending: false, receivedBytes: 0, connections: 0, observedConnections: 0, clients: new Set(), hour: Math.floor(Date.now() / HOUR) * HOUR, remaining: emptyRemaining() };
}
export function withDbTrafficSource<T>(source: DbTrafficSource, fn: () => T): T { return state().context.run({ source }, fn); }
export function setDbTrafficSource(source: DbTrafficSource) { const context = state().context.getStore(); if (context) context.source = source; }
export function dbTrafficSource(route?: string): DbTrafficSource {
  const current = state().context.getStore()?.source;
  if (current) return current;
  const prefix = route?.startsWith("/api/cron/") ? "scheduler." : route?.startsWith("/api/integrations/dak/") ? "dak." : undefined;
  const candidate = prefix === "scheduler." ? prefix + route!.slice("/api/cron/".length) : undefined;
  if (candidate && (DB_SOURCES as readonly string[]).includes(candidate)) return candidate as DbTrafficSource;
  return route?.startsWith("/api/mizar/") ? "mizar" : prefix === "dak." ? "dak" : prefix === "scheduler." ? "scheduler" : route ? "context.unmapped" : "context.absent";
}
/** Digest a bounded normalized shape locally; identifiers never leave the process. */
export function queryShape(sql: unknown): string {
  if (typeof sql !== "string" || sql.length > 100000) return "unknown";
  const tokens = sql.match(/--[^\n]*|\/\*[\s\S]*?\*\/|\$([A-Za-z_][A-Za-z_0-9]*)\$[\s\S]*?\$\1\$|\$\$[\s\S]*?\$\$|(?:[eE])?'(?:''|\\[\s\S]|[^'\\])*'|"(?:""|[^"])*"|\$\d+|[A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d+)?|[(),;=<>+*/-]/g) ?? [];
  if (tokens.length > 4096) return "unknown";
  const shape = tokens.flatMap(t => {
    if (t.startsWith("--") || t.startsWith("/*")) return [];
    if (t.startsWith("'") || /^[eE]'/.test(t) || t.startsWith("$") || /^\d/.test(t)) return ["?"];
    return [t.startsWith('"') ? t : t.toLowerCase()];
  }).join(" ");
  return `q${createHash("sha256").update(shape).digest("hex").slice(0, 16)}`;
}
function ensureWindow() {
  const s = state();
  if (Math.floor(Date.now() / HOUR) * HOUR !== s.hour) flushDbTraffic();
}
function scores(s: State): Map<string, number> {
  return s.shapeScores ??= new Map([...s.rows].filter(([, row]) => row.template !== "overflow").map(([key, row]) => [key, row.rxBytes]));
}
function mergeMeasuredRow(target: Row, source: Row) {
  for (const field of ["queries", "failures", "rows", "queryMs", "logicalRowJsonBytes", "logicalMeasuredQueries", "rxBytes"] as const) target[field] += source[field];
  for (const field of ["budget", "unsupported_value", "error"] as const) target.skipReasons[field] += source.skipReasons[field];
}
function getRow(source: DbTrafficSource, template: string, rxWeight = 0): Row {
  const s = state(); const map = s.rows; const ranking = scores(s);
  const makeRow = (rowSource: DbTrafficSource, rowTemplate: string): Row => {
    const key = `${rowSource}:${rowTemplate}`;
    let row = map.get(key);
    if (!row) { row = { source: rowSource, template: rowTemplate, queries: 0, failures: 0, rows: 0, queryMs: 0, logicalRowJsonBytes: 0, logicalMeasuredQueries: 0, rxBytes: 0, skipReasons: { budget: 0, unsupported_value: 0, error: 0 } }; map.set(key, row); }
    return row;
  };
  if (template === "overflow") return makeRow(source, template);
  const key = `${source}:${template}`; const existing = map.get(key);
  if (existing) { ranking.set(key, (ranking.get(key) ?? existing.rxBytes) + rxWeight); return existing; }
  if (ranking.size >= 40) {
    if (!rxWeight || s.sealing) return makeRow(source, "overflow");
    let victim: string | undefined; let minimum = Infinity;
    for (const [candidate, score] of ranking) if (score < minimum) { victim = candidate; minimum = score; }
    if (victim !== undefined) {
      const row = map.get(victim)!;
      mergeMeasuredRow(makeRow(row.source, "overflow"), row);
      map.delete(victim); ranking.delete(victim);
    }
    ranking.set(key, minimum + rxWeight);
  } else ranking.set(key, rxWeight);
  return makeRow(source, template);
}
export type LogicalSkipReason = "budget" | "unsupported_value" | "error";
export function recordDbTraffic(source: DbTrafficSource, template: DbTemplate, rows: number, ms: number, failure: boolean, logicalBytes?: number, skipReason?: LogicalSkipReason) {
  if (!dbTrafficEnabled()) return;
  const s = state(); const at = Date.now(); if (!s.deliveryStarted) s.earliestObservedAt = Math.min(s.earliestObservedAt ?? at, at);
  ensureWindow();
  const row = getRow(source, template);
  row.queries++; row.failures += failure ? 1 : 0; row.rows += rows; row.queryMs += ms;
  if (logicalBytes !== undefined) { row.logicalRowJsonBytes += logicalBytes; row.logicalMeasuredQueries++; }
  else if (skipReason) row.skipReasons[skipReason]++;
}
export function observeDbStream(client: PoolClient) {
  const s = state(); s.connections++;
  let observed = false;
  try {
    observed = observePgTraffic(client, {
      enabled: dbTrafficEnabled,
      raw(bytes) { const at = Date.now(); if (!s.deliveryStarted) s.earliestObservedAt = Math.min(s.earliestObservedAt ?? at, at); ensureWindow(); s.receivedBytes += bytes; },
      attribute(owner, bytes) {
        if (typeof owner === "object") getRow(owner.source, owner.template, bytes).rxBytes += bytes;
        else s.remaining[owner] += bytes;
      },
    });
  } catch { /* Preserve the driver connection. */ }
  if (observed) { s.observedConnections++; s.clients.add(client); }
  else if (dbTrafficEnabled()) { const at = Date.now(); s.coverageUnknownSince = Math.min(s.coverageUnknownSince ?? at, at); }
  client.once("end", () => {
    try { settlePgTraffic(client); } catch { /* Preserve connection shutdown. */ }
    s.connections--; if (observed) { s.observedConnections--; s.clients.delete(client); }
  });
}
let lastKey: string | undefined; let lastEndpoint: string | undefined; let lastHealth: string | undefined; let enabled = false;
export function dbTrafficEnabled(): boolean {
  const key = process.env.DB_TRAFFIC_KEY; const endpoint = process.env.PRODUCT_TELEMETRY_ENDPOINT; const health = process.env.RIVALHUB_RUNTIME_HEALTH_ENABLED;
  if (key === lastKey && endpoint === lastEndpoint && health === lastHealth) return enabled;
  lastKey = key; lastEndpoint = endpoint; lastHealth = health; enabled = false;
  if (health === "0" || (key?.length ?? 0) < 32) return false;
  try { const url = new URL(endpoint ?? ""); enabled = url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/v1/batches"; } catch { /* Disabled on invalid configuration. */ }
  return enabled;
}
/** Synchronous exit is the only point Next guarantees before process.exit(). */
function armExitCapsule(s: State): void {
  s.exitCapsuleArmed = true;
  const host = process as unknown as Record<symbol, unknown>;
  const hook = Symbol.for("rivalhub.db-traffic.exit-hook.v1");
  if (host[hook]) return;
  host[hook] = true;
  process.on("exit", () => {
    const current = (process as unknown as Record<symbol, State | undefined>)[slot];
    const directory = process.env.DB_TRAFFIC_SPOOL_DIRECTORY;
    if (!current?.exitCapsuleArmed || !directory || !dbTrafficEnabled()) return;
    try {
      // Pending driver frames have already contributed to receivedBytes. Move
      // their observed prefix to partial before capturing the residual batch.
      for (const client of current.clients) settlePgTraffic(client);
      const now = Date.now(); const sealing = current.sealing; const batches: string[] = [];
      let unknownAt = current.coverageUnknownSince ?? null;
      if (sealing) {
        const value = JSON.parse(sealing.body);
        if (Buffer.byteLength(sealing.body) <= 40000 && isSafeDbTrafficBatch(value)) batches.push(sealing.body);
        else unknownAt = Math.min(unknownAt ?? sealing.capturedAt, sealing.capturedAt);
      }
      const prior = new Map((sealing?.rows ?? []).map(row => [`${row.source}:${row.template}`, row]));
      const rows = structuredClone([...current.rows.values()]);
      for (const row of rows) {
        const snapshot = prior.get(`${row.source}:${row.template}`); if (!snapshot) continue;
        for (const field of ["queries", "failures", "rows", "queryMs", "logicalRowJsonBytes", "logicalMeasuredQueries", "rxBytes"] as const) row[field] = Math.max(0, row[field] - snapshot[field]);
        for (const field of ["budget", "unsupported_value", "error"] as const) row.skipReasons[field] = Math.max(0, row.skipReasons[field] - snapshot.skipReasons[field]);
      }
      const remaining = { ...current.remaining };
      for (const field of ["async", "no_owner", "partial", "unsupported", "instrumentation"] as const) remaining[field] = Math.max(0, remaining[field] - (sealing?.remaining[field] ?? 0));
      const receivedBytes = Math.max(0, current.receivedBytes - (sealing?.receivedBytes ?? 0));
      const retainedRows = rows.filter(row => row.queries || row.failures || row.rows || row.queryMs || row.logicalRowJsonBytes || row.logicalMeasuredQueries || row.rxBytes || Object.values(row.skipReasons).some(Boolean));
      if (retainedRows.length || receivedBytes) {
        const rawRelease = process.env.RIVALHUB_RELEASE_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || "unknown";
        const rawDeployment = process.env.VERCEL_DEPLOYMENT_ID || "unknown";
        const batch = { id: crypto.randomUUID(), process: current.processId, at: Math.min(now, current.hour + HOUR - 1), release: /^[A-Za-z0-9._-]{1,80}$/.test(rawRelease) ? rawRelease : "unknown", deployment: /^[A-Za-z0-9._-]{1,80}$/.test(rawDeployment) ? rawDeployment : "unknown", dropped: 0, receivedBytes, connections: current.connections, observedConnections: current.observedConnections, rows: retainedRows, remainingRxBytes: Object.values(remaining).reduce((sum, value) => sum + value, 0), remaining, droppedReceivedBytes: 0, unconfirmedReceivedBytes: 0, unconfirmedBatches: 0 };
        const body = JSON.stringify(batch);
        if (Buffer.byteLength(body) <= 40000 && isSafeDbTrafficBatch(batch)) batches.push(body);
        else unknownAt = Math.min(unknownAt ?? now, now);
      }
      if (batches.length || unknownAt !== null) writeExitCapsule(directory, { version: 1, batches, unknownAt });
    } catch { try { writeSync(2, '{"event":"db_traffic.exit_capsule_failure"}\n'); } catch { /* Exit must continue. */ } }
  });
}

type SendResult = { ok: boolean; status: number | null; retryAfter: number | null; limit: string | null };
function statusCode(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}
const diagnosticSlot = Symbol.for("rivalhub.db-traffic.send-diagnostic.v1");
function reportSendFailure(status: number | null) {
  try {
    const host = process as unknown as Record<symbol, { last: number; suppressed: number } | undefined>;
    const now = Date.now(); const window = host[diagnosticSlot];
    if (window && now >= window.last && now - window.last < 60000) { window.suppressed++; return; }
    process.stderr.write(`${JSON.stringify({ event: "db_traffic.send_failure", httpStatus: status, suppressed: window?.suppressed ?? 0 })}\n`);
    host[diagnosticSlot] = { last: now, suppressed: 0 };
  } catch { /* Diagnostics must not change delivery or retry. */ }
}
async function sendDbTraffic(endpoint: URL, body: string, key: string): Promise<SendResult> {
  const parsed = JSON.parse(body) as { id: string };
  const digest = await digestDbTraffic(parsed);
  const parse = (status: number | null, text: string, retryAfter: string | null, limit: string | null): SendResult => {
    let ack: { protocol?: unknown; id?: unknown; digest?: unknown; status?: unknown } = {};
    try { ack = JSON.parse(text); } catch { /* Missing or malformed ACK is uncertain. */ }
    const delay = Number(retryAfter);
    return { ok: status === 200 && ack.protocol === 2 && ack.id === parsed.id && ack.digest === digest && (ack.status === "accepted" || ack.status === "quarantined"), status, retryAfter: retryAfter && Number.isFinite(delay) && delay >= 0 ? Math.min(delay, 86400) : null, limit };
  };
  const headers = { authorization: `Bearer ${key}`, "content-type": "application/json", "x-db-traffic-protocol": "2" };
  const proxyValue = process.env.PRODUCT_TELEMETRY_QUERY_PROXY_URL;
  if (!proxyValue) {
    const response = await fetch(endpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(5000), redirect: "error" });
    const reader = response.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    if (reader) for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 4096) { await reader.cancel(); return parse(statusCode(response.status), "", response.headers.get("retry-after"), response.headers.get("x-db-traffic-limit")); } chunks.push(part.value); }
    const data = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    return parse(statusCode(response.status), new TextDecoder().decode(data), response.headers.get("retry-after"), response.headers.get("x-db-traffic-limit"));
  }
  const proxy = new URL(proxyValue);
  if (!["http:", "https:"].includes(proxy.protocol) || proxy.username || proxy.password || proxy.pathname !== "/" || proxy.search || proxy.hash) throw new Error("Invalid telemetry proxy");
  const agent = new Agent({ proxyEnv: { NODE_ENV: process.env.NODE_ENV, HTTPS_PROXY: proxy.href } });
  try {
    return await new Promise<SendResult>((resolve, reject) => {
      const req = request(endpoint, { method: "POST", agent, signal: AbortSignal.timeout(5000), headers }, response => {
        const chunks: Buffer[] = []; let size = 0;
        response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 4096) response.destroy(new Error("ACK too large")); else chunks.push(chunk); });
        response.on("error", reject);
        response.on("end", () => resolve(parse(statusCode(response.statusCode), Buffer.concat(chunks).toString("utf8"), typeof response.headers["retry-after"] === "string" ? response.headers["retry-after"] : null, typeof response.headers["x-db-traffic-limit"] === "string" ? response.headers["x-db-traffic-limit"] : null)));
      });
      req.on("error", reject); req.end(body);
    });
  } finally { agent.destroy(); }
}
function hasUnsealedResidual(s: State): boolean {
  const sealing = s.sealing; if (!sealing) return false;
  if (s.receivedBytes !== sealing.receivedBytes || s.rows.size !== sealing.rows.length) return true;
  for (const field of ["async", "no_owner", "partial", "unsupported", "instrumentation"] as const) if (s.remaining[field] !== sealing.remaining[field]) return true;
  for (const snapshot of sealing.rows) {
    const row = s.rows.get(`${snapshot.source}:${snapshot.template}`); if (!row) return true;
    for (const field of ["queries", "failures", "rows", "queryMs", "logicalRowJsonBytes", "logicalMeasuredQueries", "rxBytes"] as const) if (row[field] !== snapshot[field]) return true;
    for (const field of ["budget", "unsupported_value", "error"] as const) if (row.skipReasons[field] !== snapshot.skipReasons[field]) return true;
  }
  return false;
}

/** Open and recover once per process, without network access. */
async function openDelivery(s: State): Promise<DbTrafficDelivery> {
  if (!s.delivery) {
    const directory = process.env.DB_TRAFFIC_SPOOL_DIRECTORY;
    if (!directory) throw new Error("database traffic spool directory is not configured");
    s.delivery = Promise.all([import("./db-traffic-spool"), import("./db-traffic-delivery")]).then(async ([{ DbTrafficSpool }, { DbTrafficDelivery }]) => {
      const spool = await DbTrafficSpool.open(directory);
      const release = process.env.RIVALHUB_RELEASE_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || "unknown";
      const deployment = process.env.VERCEL_DEPLOYMENT_ID || "unknown";
      return new DbTrafficDelivery(spool, { process: s.processId, release: /^[A-Za-z0-9._-]{1,80}$/.test(release) ? release : "unknown", deployment: /^[A-Za-z0-9._-]{1,80}$/.test(deployment) ? deployment : "unknown" });
    });
  }
  try { return await s.delivery; } catch (error) { s.delivery = undefined; throw error; }
}
function markStartupDegraded(s: State, at: number): void {
  const first = s.degradedSince === undefined; s.degradedSince = Math.min(s.degradedSince ?? at, at);
  if (first) try { writeSync(2, '{"event":"db_traffic.startup_degraded"}\n'); } catch { /* Business startup must continue. */ }
}
/** Await only the durable recovery marker; a timed-out attempt remains singleflight. */
export async function initializeDbTraffic(timeoutMs = 5000): Promise<boolean> {
  if (!dbTrafficEnabled()) return true;
  const s = state(); if (s.deliveryStarted) return true;
  if (!s.initializing) {
    const startedAt = Date.now(); s.initStartedAt = Math.min(s.initStartedAt ?? startedAt, startedAt);
    const attempt = (async () => {
      try {
        if (s.maintenance) await s.maintenance;
        const delivery = await openDelivery(s);
        await delivery.start(startedAt, () => Math.min(s.initStartedAt ?? startedAt, s.earliestObservedAt ?? startedAt));
        // A timeout can happen during either commit. Persist it before exposing
        // readiness; observations during the commit cannot predate startedAt.
        while (s.degradedSince !== undefined) {
          const degraded = s.degradedSince; await delivery.noteUnknown(degraded, Date.now());
          if (s.degradedSince === degraded) s.degradedSince = undefined;
        }
        s.deliveryStarted = true; s.earliestObservedAt = undefined; armExitCapsule(s); return true;
      } catch { markStartupDegraded(s, s.initStartedAt ?? startedAt); return false; }
    })();
    s.initializing = attempt; void attempt.finally(() => { if (s.initializing === attempt) s.initializing = undefined; });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>(resolve => { timer = setTimeout(() => { markStartupDegraded(s, s.initStartedAt ?? Date.now()); resolve(false); }, Math.max(0, timeoutMs)); });
  try { return await Promise.race([s.initializing, timeout]); } finally { if (timer) clearTimeout(timer); }
}

/** Seal before clearing measurements; the shared owner serializes disk and network. */
export function flushDbTraffic() {
  const s = state();
  const enabled = dbTrafficEnabled();
  const now = Date.now();
  if (enabled && s.sealing && Math.floor(now / HOUR) * HOUR !== s.hour) {
    if (hasUnsealedResidual(s)) s.coverageUnknownSince = Math.min(s.coverageUnknownSince ?? s.hour, s.hour);
    s.hour = Math.floor(now / HOUR) * HOUR;
  }
  if ((!enabled && !process.env.DB_TRAFFIC_SPOOL_DIRECTORY) || now < (s.diskNextAttemptAt ?? 0)) return;
  if (enabled && !s.sealing) for (const client of s.clients) settlePgTraffic(client);
  if (enabled && !s.sealing && !s.rows.size && !s.receivedBytes) s.hour = Math.floor(now / HOUR) * HOUR;
  if (enabled && !s.sealing && (s.rows.size || s.receivedBytes || s.coverageUnknownSince !== undefined)) {
    const releaseValue = process.env.RIVALHUB_RELEASE_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || "unknown";
    const deploymentValue = process.env.VERCEL_DEPLOYMENT_ID || "unknown";
    const release = /^[A-Za-z0-9._-]{1,80}$/.test(releaseValue) ? releaseValue : "unknown";
    const deployment = /^[A-Za-z0-9._-]{1,80}$/.test(deploymentValue) ? deploymentValue : "unknown";
    const rows = structuredClone([...s.rows.values()]); const remaining = { ...s.remaining };
    const at = Math.min(now, s.hour + HOUR - 1);
    const batch = { id: crypto.randomUUID(), process: s.processId, at, release, deployment, dropped: 0, receivedBytes: s.receivedBytes, connections: s.connections, observedConnections: s.observedConnections, rows, remainingRxBytes: Object.values(remaining).reduce((sum, value) => sum + value, 0), remaining, droppedReceivedBytes: 0, unconfirmedReceivedBytes: 0, unconfirmedBatches: 0 };
    s.sealing = { body: JSON.stringify(batch), rows, receivedBytes: s.receivedBytes, remaining, at, capturedAt: now };
    s.hour = Math.floor(now / HOUR) * HOUR;
  }
  if (s.sending) { s.flushAgain = true; return; }
  s.sending = true;
  void (async () => {
    if (!enabled) {
      const priorInitialization = s.initializing;
      const maintenance = (async () => { if (priorInitialization) await priorInitialization; const delivery = await openDelivery(s); await delivery.prune(Date.now()); })();
      s.maintenance = maintenance;
      try { await maintenance; } finally { if (s.maintenance === maintenance) s.maintenance = undefined; }
      return;
    }
    if (!await initializeDbTraffic()) return;
    const delivery = await openDelivery(s);
    await delivery.prune(Date.now());
    if (!dbTrafficEnabled()) return;
    const sealing = s.sealing;
    if (sealing) {
      const batch = JSON.parse(sealing.body); const coverage = s.coverageUnknownSince;
      if (Buffer.byteLength(sealing.body) <= 40000 && isSafeDbTrafficBatch(batch)) await delivery.seal(sealing.body, Date.now(), coverage, sealing.capturedAt);
      else { await delivery.rejectUnsafe(sealing.body, Date.now(), coverage, sealing.capturedAt); reportSendFailure(400); }
      if (s.coverageUnknownSince === coverage) s.coverageUnknownSince = undefined;
      for (const snapshot of sealing.rows) {
        const key = `${snapshot.source}:${snapshot.template}`; const row = s.rows.get(key); if (!row) continue;
        for (const field of ["queries", "failures", "rows", "queryMs", "logicalRowJsonBytes", "logicalMeasuredQueries", "rxBytes"] as const) row[field] = Number.isFinite(row[field]) && Number.isFinite(snapshot[field]) ? Math.max(0, row[field] - snapshot[field]) : 0;
        for (const field of ["budget", "unsupported_value", "error"] as const) row.skipReasons[field] = Number.isFinite(row.skipReasons[field]) && Number.isFinite(snapshot.skipReasons[field]) ? Math.max(0, row.skipReasons[field] - snapshot.skipReasons[field]) : 0;
        if (!row.queries && !row.failures && !row.rows && !row.queryMs && !row.logicalRowJsonBytes && !row.logicalMeasuredQueries && !row.rxBytes && !Object.values(row.skipReasons).some(Boolean)) s.rows.delete(key);
      }
      s.receivedBytes = Number.isFinite(s.receivedBytes) && Number.isFinite(sealing.receivedBytes) ? Math.max(0, s.receivedBytes - sealing.receivedBytes) : 0;
      for (const field of ["async", "no_owner", "partial", "unsupported", "instrumentation"] as const) s.remaining[field] = Number.isFinite(s.remaining[field]) && Number.isFinite(sealing.remaining[field]) ? Math.max(0, s.remaining[field] - sealing.remaining[field]) : 0;
      s.sealing = undefined;
      s.shapeScores = new Map([...s.rows].filter(([, row]) => row.template !== "overflow").map(([key, row]) => [key, row.rxBytes]));
    }
    if (!dbTrafficEnabled()) return;
    const endpoint = new URL(process.env.PRODUCT_TELEMETRY_ENDPOINT!);
    const budgetNow = Date.now();
    if (s.budgetStartedAt === undefined || budgetNow < s.budgetStartedAt || budgetNow >= s.budgetStartedAt + 20000) { s.budgetStartedAt = budgetNow; s.budgetSent = 0; }
    await delivery.drain(async (item, gap) => { endpoint.pathname = gap ? "/v1/db-traffic-gap" : "/v1/db-traffic"; try { const result = await sendDbTraffic(endpoint, item.body, process.env.DB_TRAFFIC_KEY!); if (!result.ok) reportSendFailure(result.status); return result; } catch (error) { reportSendFailure(null); throw error; } }, Date.now, { maxAttempts: Math.max(0, 8 - (s.budgetSent ?? 0)), deadline: s.budgetStartedAt + 20000, onAttempt() { s.budgetSent = (s.budgetSent ?? 0) + 1; } });
  })().catch(() => { s.diskNextAttemptAt = Date.now() + 60000; reportSendFailure(null); }).finally(() => { s.sending = false; const again = s.flushAgain; s.flushAgain = false; if (again && Date.now() >= (s.diskNextAttemptAt ?? 0)) flushDbTraffic(); });
}

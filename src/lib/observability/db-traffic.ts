import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { Agent, request } from "node:https";
import type { PoolClient } from "pg";
import { observePgTraffic, resetPgTraffic, settlePgTraffic } from "./pg-traffic-adapter";

import { DB_SOURCES, type DbTrafficSource } from "./db-traffic-contract";
export { DB_SOURCES, type DbTrafficSource } from "./db-traffic-contract";
export type DbTemplate = string;
type Row = { source: DbTrafficSource; template: string; queries: number; failures: number; rows: number; queryMs: number; logicalRowJsonBytes: number; logicalMeasuredQueries: number; rxBytes: number; skipReasons: { budget: number; unsupported_value: number; error: number } };
type Context = { source: DbTrafficSource };
type State = { context: AsyncLocalStorage<Context>; rows: Map<string, Row>; processId: string; pending: { body: string; at: number; dropped: number; droppedReceivedBytes: number; unconfirmedReceivedBytes: number; unconfirmedBatches: number; receivedBytes: number; attempted: boolean }[]; sending: boolean; dropped: number; droppedReceivedBytes: number; unconfirmedReceivedBytes: number; unconfirmedBatches: number; receivedBytes: number; connections: number; observedConnections: number; clients: Set<PoolClient>; hour: number; remaining: Remaining };
type Remaining = { async: number; no_owner: number; partial: number; unsupported: number; instrumentation: number };
function emptyRemaining(): Remaining { return { async: 0, no_owner: 0, partial: 0, unsupported: 0, instrumentation: 0 }; }
const HOUR = 3600000;
const slot = Symbol.for("rivalhub.db-traffic.v3");
function state(): State {
  const host = process as unknown as Record<symbol, State | undefined>;
  return host[slot] ??= { context: new AsyncLocalStorage(), rows: new Map(), processId: crypto.randomUUID(), pending: [], sending: false, dropped: 0, droppedReceivedBytes: 0, unconfirmedReceivedBytes: 0, unconfirmedBatches: 0, receivedBytes: 0, connections: 0, observedConnections: 0, clients: new Set(), hour: Math.floor(Date.now() / HOUR) * HOUR, remaining: emptyRemaining() };
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
function getRow(source: DbTrafficSource, template: string): Row {
  const map = state().rows; let key = `${source}:${template}`;
  if (!map.has(key) && map.size >= 40) { template = "overflow"; key = `${source}:${template}`; }
  let row = map.get(key);
  if (!row) { row = { source, template, queries: 0, failures: 0, rows: 0, queryMs: 0, logicalRowJsonBytes: 0, logicalMeasuredQueries: 0, rxBytes: 0, skipReasons: { budget: 0, unsupported_value: 0, error: 0 } }; map.set(key, row); }
  return row;
}
export type LogicalSkipReason = "budget" | "unsupported_value" | "error";
export function recordDbTraffic(source: DbTrafficSource, template: DbTemplate, rows: number, ms: number, failure: boolean, logicalBytes?: number, skipReason?: LogicalSkipReason) {
  if (!dbTrafficEnabled()) return;
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
      raw(bytes) { ensureWindow(); s.receivedBytes += bytes; },
      attribute(owner, bytes) {
        if (typeof owner === "object") getRow(owner.source, owner.template).rxBytes += bytes;
        else s.remaining[owner] += bytes;
      },
    });
  } catch { /* Preserve the driver connection. */ }
  if (observed) { s.observedConnections++; s.clients.add(client); }
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
type SendResult = { ok: boolean; status: number | null };
function statusCode(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}
// Process-local and bounded: report the first failure, then at most once a minute.
const diagnosticSlot = Symbol.for("rivalhub.db-traffic.send-diagnostic.v1");
function reportSendFailure(s: State, status: number | null, retrySameHead: boolean) {
  try {
    const host = process as unknown as Record<symbol, { last: number; suppressed: number } | undefined>;
    const now = Date.now(); const window = host[diagnosticSlot];
    if (window && now >= window.last && now - window.last < 60000) { window.suppressed++; return; }
    const dropped = s.dropped + s.pending.reduce((sum, item) => sum + item.dropped, 0);
    process.stderr.write(`${JSON.stringify({ event: "db_traffic.send_failure", httpStatus: status, retrySameHead, queued: s.pending.length, dropped, suppressed: window?.suppressed ?? 0 })}\n`);
    host[diagnosticSlot] = { last: now, suppressed: 0 };
  } catch { /* Diagnostics must not change delivery or retry. */ }
}
async function sendDbTraffic(endpoint: URL, body: string, key: string): Promise<SendResult> {
  const proxyValue = process.env.PRODUCT_TELEMETRY_QUERY_PROXY_URL;
  if (!proxyValue) {
    const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body, signal: AbortSignal.timeout(5000), redirect: "error" });
    void response.body?.cancel().catch(() => {});
    return { ok: response.ok, status: statusCode(response.status) };
  }
  const proxy = new URL(proxyValue);
  if (!["http:", "https:"].includes(proxy.protocol) || proxy.username || proxy.password || proxy.pathname !== "/" || proxy.search || proxy.hash) throw new Error("Invalid telemetry proxy");
  const agent = new Agent({ proxyEnv: { NODE_ENV: process.env.NODE_ENV, HTTPS_PROXY: proxy.href } });
  try {
    return await new Promise<SendResult>((resolve, reject) => {
      const req = request(endpoint, { method: "POST", agent, signal: AbortSignal.timeout(5000), headers: { authorization: `Bearer ${key}`, "content-type": "application/json" } }, response => {
        response.resume();
        resolve({ ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300, status: statusCode(response.statusCode) });
      });
      req.on("error", reject);
      req.end(body);
    });
  } finally { agent.destroy(); }
}
/** Best effort, bounded retry queue. Batch identity remains unchanged after a lost ACK. */
export function flushDbTraffic() {
  const s = state();
  if (!dbTrafficEnabled()) { for (const client of s.clients) resetPgTraffic(client); s.rows.clear(); s.pending.length = 0; s.dropped = 0; s.droppedReceivedBytes = 0; s.unconfirmedReceivedBytes = 0; s.unconfirmedBatches = 0; s.receivedBytes = 0; s.remaining = emptyRemaining(); s.hour = Math.floor(Date.now() / HOUR) * HOUR; return; }
  for (const client of s.clients) settlePgTraffic(client);
  while (!s.sending && s.pending[0] && s.pending[0].at < Date.now() - 23 * 3600000) {
    const expired = s.pending.shift()!;
    if (expired.attempted) {
      // A lost ACK may mean the worker already stored this batch. Do not claim loss.
      s.unconfirmedBatches += 1 + expired.dropped + expired.unconfirmedBatches;
      s.unconfirmedReceivedBytes += expired.receivedBytes + expired.droppedReceivedBytes + expired.unconfirmedReceivedBytes;
    } else {
      s.dropped += 1 + expired.dropped; s.droppedReceivedBytes += expired.receivedBytes + expired.droppedReceivedBytes;
      s.unconfirmedBatches += expired.unconfirmedBatches; s.unconfirmedReceivedBytes += expired.unconfirmedReceivedBytes;
    }
  }
  if (s.rows.size || s.receivedBytes || (s.pending.length < 5 && (s.dropped || s.droppedReceivedBytes || s.unconfirmedBatches || s.unconfirmedReceivedBytes))) {
    const release = process.env.RIVALHUB_RELEASE_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || "unknown";
    const deploymentValue = process.env.VERCEL_DEPLOYMENT_ID || "unknown";
    const deployment = /^[A-Za-z0-9._-]{1,80}$/.test(deploymentValue) ? deploymentValue : "unknown";
    const batch = { deployment, dropped: s.dropped, droppedReceivedBytes: s.droppedReceivedBytes, unconfirmedReceivedBytes: s.unconfirmedReceivedBytes, unconfirmedBatches: s.unconfirmedBatches, id: crypto.randomUUID(), process: s.processId, at: s.rows.size || s.receivedBytes ? Math.min(Date.now(), s.hour + HOUR - 1) : Date.now(), release: /^[A-Za-z0-9._-]{1,80}$/.test(release) ? release : "unknown", rows: [...s.rows.values()], receivedBytes: s.receivedBytes, remaining: s.remaining, remainingRxBytes: Object.values(s.remaining).reduce((sum, value) => sum + value, 0), connections: s.connections, observedConnections: s.observedConnections };
    s.rows.clear(); s.receivedBytes = 0; s.remaining = emptyRemaining();
    if (s.pending.length < 5) { s.pending.push({ body: JSON.stringify(batch), at: batch.at, dropped: batch.dropped, droppedReceivedBytes: batch.droppedReceivedBytes, unconfirmedReceivedBytes: batch.unconfirmedReceivedBytes, unconfirmedBatches: batch.unconfirmedBatches, receivedBytes: batch.receivedBytes, attempted: false }); s.dropped = 0; s.droppedReceivedBytes = 0; s.unconfirmedReceivedBytes = 0; s.unconfirmedBatches = 0; }
    else { s.dropped++; s.droppedReceivedBytes += batch.receivedBytes; }
  }
  s.hour = Math.floor(Date.now() / HOUR) * HOUR;
  let endpoint: URL;
  try { endpoint = new URL(process.env.PRODUCT_TELEMETRY_ENDPOINT ?? ""); } catch { return; }
  if (s.sending || !s.pending.length) return;
  endpoint.pathname = "/v1/db-traffic"; s.sending = true;
  const sending = s.pending[0]; const retrySameHead = sending.attempted; sending.attempted = true;
  void Promise.resolve().then(() => sendDbTraffic(endpoint, sending.body, process.env.DB_TRAFFIC_KEY!)).then(result => {
    if (result.ok && s.pending[0] === sending) s.pending.shift();
    else if (!result.ok) reportSendFailure(s, result.status, retrySameHead);
  }).catch(() => { reportSendFailure(s, null, retrySameHead); }).finally(() => { s.sending = false; });
}

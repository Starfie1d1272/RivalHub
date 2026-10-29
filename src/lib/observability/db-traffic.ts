import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

import { DB_SOURCES, type DbTrafficSource } from "./db-traffic-contract";
export { DB_SOURCES, type DbTrafficSource } from "./db-traffic-contract";
export type DbTemplate = string;
type Row = { source: DbTrafficSource; template: string; queries: number; failures: number; rows: number; queryMs: number };
type Context = { source: DbTrafficSource };
type State = { context: AsyncLocalStorage<Context>; rows: Map<string, Row>; processId: string; pending: { body: string; at: number; dropped: number }[]; sending: boolean; dropped: number; receivedBytes: number; connections: number; observedConnections: number };
const slot = Symbol.for("rivalhub.db-traffic.v2");
function state(): State {
  const host = process as unknown as Record<symbol, State | undefined>;
  return host[slot] ??= { context: new AsyncLocalStorage(), rows: new Map(), processId: crypto.randomUUID(), pending: [], sending: false, dropped: 0, receivedBytes: 0, connections: 0, observedConnections: 0 };
}
export function withDbTrafficSource<T>(source: DbTrafficSource, fn: () => T): T { return state().context.run({ source }, fn); }
export function setDbTrafficSource(source: DbTrafficSource) { const context = state().context.getStore(); if (context) context.source = source; }
export function dbTrafficSource(route?: string): DbTrafficSource {
  const current = state().context.getStore()?.source;
  if (current) return current;
  const prefix = route?.startsWith("/api/cron/") ? "scheduler." : route?.startsWith("/api/integrations/dak/") ? "dak." : undefined;
  const candidate = prefix === "scheduler." ? prefix + route!.slice("/api/cron/".length) : undefined;
  if (candidate && (DB_SOURCES as readonly string[]).includes(candidate)) return candidate as DbTrafficSource;
  return route?.startsWith("/api/mizar/") ? "mizar" : prefix === "dak." ? "dak" : prefix === "scheduler." ? "scheduler" : "unknown";
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
export function recordDbTraffic(source: DbTrafficSource, template: DbTemplate, rows: number, ms: number, failure: boolean) {
  if (!dbTrafficEnabled()) return;
  const map = state().rows; let key = `${source}:${template}`;
  if (!map.has(key) && map.size >= 80) { template = "overflow"; key = `${source}:${template}`; }
  const row = map.get(key) ?? { source, template, queries: 0, failures: 0, rows: 0, queryMs: 0 };
  row.queries++; row.failures += failure ? 1 : 0; row.rows += rows; row.queryMs += ms; map.set(key, row);
}
export function observeDbStream(client: { once(event: string, callback: () => void): unknown }, stream: { on(event: string, callback: (...args: never[]) => void): unknown } | null) {
  const s = state(); s.connections++;
  const observed = !!stream && typeof stream.on === "function";
  if (observed) s.observedConnections++;
  client.once("end", () => { s.connections--; if (observed) s.observedConnections--; });
  if (!observed || !stream) return;
  stream.on("data", ((chunk: unknown) => { try { if (dbTrafficEnabled() && (chunk instanceof Uint8Array)) s.receivedBytes += chunk.byteLength; } catch { /* Preserve the driver stream. */ } }) as (...args: never[]) => void);
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
/** Best effort, bounded retry queue. Batch identity remains unchanged after a lost ACK. */
export function flushDbTraffic() {
  const s = state();
  if (!dbTrafficEnabled()) { s.rows.clear(); s.pending.length = 0; s.dropped = 0; s.receivedBytes = 0; return; }
  while (!s.sending && s.pending[0] && s.pending[0].at < Date.now() - 23 * 3600000) { const expired = s.pending.shift()!; s.dropped += 1 + expired.dropped; }
  if (s.rows.size || s.receivedBytes) {
    const release = process.env.RIVALHUB_RELEASE_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || "unknown";
    const deploymentValue = process.env.VERCEL_DEPLOYMENT_ID || "unknown";
    const deployment = /^[A-Za-z0-9._-]{1,80}$/.test(deploymentValue) ? deploymentValue : "unknown";
    const batch = { deployment, dropped: s.dropped, id: crypto.randomUUID(), process: s.processId, at: Date.now(), release: /^[A-Za-z0-9._-]{1,80}$/.test(release) ? release : "unknown", rows: [...s.rows.values()], receivedBytes: s.receivedBytes, connections: s.connections, observedConnections: s.observedConnections };
    s.rows.clear(); s.receivedBytes = 0;
    if (s.pending.length < 5) { s.pending.push({ body: JSON.stringify(batch), at: batch.at, dropped: batch.dropped }); s.dropped = 0; }
    else s.dropped++;
  }
  let endpoint: URL;
  try { endpoint = new URL(process.env.PRODUCT_TELEMETRY_ENDPOINT ?? ""); } catch { return; }
  if (s.sending || !s.pending.length) return;
  endpoint.pathname = "/v1/db-traffic"; s.sending = true;
  const sending = s.pending[0];
  void Promise.resolve().then(() => fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${process.env.DB_TRAFFIC_KEY}`, "content-type": "application/json" }, body: sending.body, signal: AbortSignal.timeout(5000), redirect: "error" })).then(response => {
    if (response.ok && s.pending[0] === sending) s.pending.shift();
  }).catch(() => {}).finally(() => { s.sending = false; });
}

import { AsyncLocalStorage } from "node:async_hooks";

export type DbTrafficSource = "mizar" | "dak" | "scheduler" | "stats.fill" | "bet.fill" | "unknown";
export const DB_TEMPLATES = ["select", "with", "insert", "update", "delete", "begin", "commit", "rollback", "rollback_to", "set", "savepoint", "release", "unknown", "unsupported"] as const;
export type DbTemplate = typeof DB_TEMPLATES[number];
type Row = { source: DbTrafficSource; template: DbTemplate; queries: number; failures: number; rows: number; queryMs: number };
type State = { context: AsyncLocalStorage<DbTrafficSource>; rows: Map<string, Row>; processId: string; pending: { body: string; at: number }[]; sending: boolean; dropped: number };
const slot = Symbol.for("rivalhub.db-traffic.v1");
function state(): State {
  const host = process as unknown as Record<symbol, State | undefined>;
  return host[slot] ??= { context: new AsyncLocalStorage(), rows: new Map(), processId: crypto.randomUUID(), pending: [], sending: false, dropped: 0 };
}
export function withDbTrafficSource<T>(source: DbTrafficSource, fn: () => T): T { return state().context.run(source, fn); }
export function dbTrafficSource(route?: string): DbTrafficSource {
  return state().context.getStore() ?? (route?.startsWith("/api/mizar/") ? "mizar" : route?.startsWith("/api/integrations/dak/") ? "dak" : route?.startsWith("/api/cron/") ? "scheduler" : "unknown");
}
export function recordDbTraffic(source: DbTrafficSource, template: DbTemplate, rows: number, ms: number, failure: boolean) {
  const map = state().rows; const key = `${source}:${template}`;
  const row = map.get(key) ?? { source, template, queries: 0, failures: 0, rows: 0, queryMs: 0 };
  row.queries++; row.failures += failure ? 1 : 0; row.rows += rows; row.queryMs += ms; map.set(key, row);
}
/** Best effort, bounded retry queue. Batch identity remains unchanged after a lost ACK. */
export function flushDbTraffic() {
  const s = state();
  if (s.rows.size) {
    const release = process.env.RIVALHUB_RELEASE_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || "unknown";
    const deploymentValue = process.env.VERCEL_DEPLOYMENT_ID || "unknown";
    const deployment = /^[A-Za-z0-9._-]{1,80}$/.test(deploymentValue) ? deploymentValue : "unknown";
    const batch = { deployment, dropped: s.dropped, id: crypto.randomUUID(), process: s.processId, at: Date.now(), release: /^[A-Za-z0-9._-]{1,80}$/.test(release) ? release : "unknown", rows: [...s.rows.values()] };
    s.rows.clear();
    if (s.pending.length < 5) { s.pending.push({ body: JSON.stringify(batch), at: batch.at }); s.dropped = 0; }
    else s.dropped++;
  }
  while (s.pending[0] && s.pending[0].at < Date.now() - 23 * 3600000) { s.pending.shift(); s.dropped++; }
  const key = process.env.DB_TRAFFIC_KEY ?? "";
  let endpoint: URL;
  try { endpoint = new URL(process.env.PRODUCT_TELEMETRY_ENDPOINT ?? ""); } catch { return; }
  if (s.sending || !s.pending.length || key.length < 32 || endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return;
  endpoint.pathname = "/v1/db-traffic"; s.sending = true;
  void fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: s.pending[0].body, signal: AbortSignal.timeout(5000), redirect: "error" }).then(response => {
    if (response.ok) s.pending.shift();
  }).catch(() => {}).finally(() => { s.sending = false; });
}

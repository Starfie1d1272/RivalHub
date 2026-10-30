import type { Env } from "./index";
import { maintainDbTraffic, maintainDbTrafficQuality, readDbTrafficHours, type TrafficSelection } from "./db-traffic-rollup";

import { DB_SOURCES, DB_TEMPLATE_PATTERN } from "../../src/lib/observability/db-traffic-contract";
const sources = new Set<string>(DB_SOURCES);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 86400000;
type RejectReason = "body_missing" | "body_size" | "json" | "object" | "loss_fields" | "envelope_keys" | "dropped" | "received_bytes" | "connections" | "identifiers" | "timestamp_invalid" | "timestamp_old" | "timestamp_future" | "release_deployment" | "row_count" | "row_keys" | "row_source" | "row_template" | "row_counts" | "row_time" | "row_logical" | "row_rx" | "row_skip_fields" | "row_skip_counts" | "remaining_fields" | "remaining_sum" | "received_sum";
// At most one event per reason per minute per isolate; no request data is logged.
const rejectWindows = new Map<RejectReason, { last: number; suppressed: number }>();
function reject(reason: RejectReason, now: number, status = 400, invalidRows = 0): Response {
  try {
    const window = rejectWindows.get(reason);
    if (window && now >= window.last && now - window.last < 60000) window.suppressed++;
    else {
      console.warn(JSON.stringify({ event: "db_traffic.reject", reason, count: 1 + (window?.suppressed ?? 0), ...(invalidRows ? { invalidRows } : {}) }));
      rejectWindows.set(reason, { last: now, suppressed: 0 });
    }
  } catch { /* Diagnostics must not change the rejection. */ }
  return new Response(null, { status });
}
export async function ingestDbTraffic(request: Request, env: Env, now: number): Promise<Response> {
  if ((env.DB_TRAFFIC_KEY?.length ?? 0) < 32 || request.headers.get("authorization") !== `Bearer ${env.DB_TRAFFIC_KEY}`) return new Response(null, { status: 401 });
  if (env.ACCEPTING !== "1" || env.RETENTION_APPROVED !== "1") return new Response(null, { status: 503 });
  const reader = request.body?.getReader(); if (!reader) return reject("body_missing", now);
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 40000) { await reader.cancel(); return reject("body_size", now, 413); } chunks.push(part.value); }
  type SkipReasons = { budget: number; unsupported_value: number; error: number };
  type Row = { source: string; template: string; queries: number; failures: number; rows: number; queryMs: number; logicalRowJsonBytes?: number; logicalMeasuredQueries?: number; rxBytes?: number; skipReasons?: SkipReasons };
  type Remaining = { async: number; no_owner: number; partial: number; unsupported: number; instrumentation: number };
  let batch: { id: string; process: string; at: number; release: string; deployment: string; dropped: number; receivedBytes: number; connections: number; observedConnections: number; rows: Row[]; remainingRxBytes?: number; remaining?: Remaining; droppedReceivedBytes?: number; unconfirmedReceivedBytes?: number; unconfirmedBatches?: number };
  try { const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } batch = JSON.parse(new TextDecoder().decode(bytes)); } catch { return reject("json", now); }
  if (!batch || typeof batch !== "object" || Array.isArray(batch)) return reject("object", now);
  const validNumber = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1e12;
  const integer = (n: unknown) => validNumber(n) && Number.isSafeInteger(n);
  const keys = (value: unknown, expected: string) => !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join() === expected;
  const oldBatch = keys(batch, "at,connections,deployment,dropped,id,observedConnections,process,receivedBytes,release,rows");
  const newBatch = keys(batch, "at,connections,deployment,dropped,id,observedConnections,process,receivedBytes,release,remaining,remainingRxBytes,rows") || keys(batch, "at,connections,deployment,dropped,droppedReceivedBytes,id,observedConnections,process,receivedBytes,release,remaining,remainingRxBytes,rows,unconfirmedBatches,unconfirmedReceivedBytes");
  const lossProvided = batch.droppedReceivedBytes !== undefined || batch.unconfirmedReceivedBytes !== undefined || batch.unconfirmedBatches !== undefined;
  if (lossProvided && (!integer(batch.droppedReceivedBytes) || !integer(batch.unconfirmedReceivedBytes) || !integer(batch.unconfirmedBatches))) return reject("loss_fields", now);
  if (!oldBatch && !newBatch) return reject("envelope_keys", now);
  if (!integer(batch.dropped) || batch.dropped > 1000000) return reject("dropped", now);
  if (!integer(batch.receivedBytes)) return reject("received_bytes", now);
  if (!integer(batch.connections) || batch.connections > 1000 || !integer(batch.observedConnections) || batch.observedConnections > 1000) return reject("connections", now);
  if (typeof batch.id !== "string" || typeof batch.process !== "string" || !uuid.test(batch.id) || !uuid.test(batch.process)) return reject("identifiers", now);
  if (!Number.isSafeInteger(batch.at)) return reject("timestamp_invalid", now);
  if (batch.at > now + 60000) return reject("timestamp_future", now);
  if (typeof batch.release !== "string" || typeof batch.deployment !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(batch.release) || !/^[A-Za-z0-9._-]{1,80}$/.test(batch.deployment)) return reject("release_deployment", now);
  if (!Array.isArray(batch.rows) || batch.rows.length > 80 + DB_SOURCES.length) return reject("row_count", now);
  const invalidRow = (row: Row): RejectReason | null => {
    const legacy = keys(row, "failures,queries,queryMs,rows,source,template") || keys(row, "failures,logicalMeasuredQueries,logicalRowJsonBytes,queries,queryMs,rows,source,template");
    const current = keys(row, "failures,logicalMeasuredQueries,logicalRowJsonBytes,queries,queryMs,rows,rxBytes,skipReasons,source,template");
    if (!(newBatch ? current : legacy)) return "row_keys";
    if (!sources.has(row.source)) return "row_source";
    if (!DB_TEMPLATE_PATTERN.test(row.template)) return "row_template";
    if (!integer(row.queries) || !integer(row.failures) || !integer(row.rows)) return "row_counts";
    if (!validNumber(row.queryMs)) return "row_time";
    if (row.logicalRowJsonBytes !== undefined && (!integer(row.logicalRowJsonBytes) || !integer(row.logicalMeasuredQueries))) return "row_logical";
    if (current && !integer(row.rxBytes)) return "row_rx";
    if (current && (!keys(row.skipReasons, "budget,error,unsupported_value") || !Object.values(row.skipReasons!).every(integer))) return "row_skip_fields";
    return null;
  };
  for (const row of batch.rows) {
    const reason = invalidRow(row);
    if (reason) return reject(reason, now, 400, 1);
  }
  if (newBatch) {
    if (!keys(batch.remaining, "async,instrumentation,no_owner,partial,unsupported") || !Object.values(batch.remaining!).every(integer) || !integer(batch.remainingRxBytes)) return reject("remaining_fields", now);
  }
  const reasons: string[] = [];
  if (batch.observedConnections > batch.connections) reasons.push("observed_connections");
  if (batch.rows.some(row => row.failures > row.queries)) reasons.push("failures");
  if (batch.rows.some(row => row.logicalMeasuredQueries !== undefined && row.logicalMeasuredQueries > row.queries)) reasons.push("logical_measured_queries");
  if (batch.rows.some(row => row.skipReasons && Object.values(row.skipReasons).reduce((sum, n) => sum + n, 0) + row.logicalMeasuredQueries! > row.queries)) reasons.push("skip_sum");
  if (newBatch && Object.values(batch.remaining!).reduce((sum, n) => sum + n, 0) !== batch.remainingRxBytes) reasons.push("remaining_sum");
  if (newBatch && batch.rows.reduce((sum, row) => sum + row.rxBytes!, 0) + batch.remainingRxBytes! !== batch.receivedBytes) reasons.push("received_sum");
  // Canonicalize only after strict validation. Missing legacy fields stay missing.
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
    return JSON.stringify(value);
  };
  const digestOf = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`db-traffic-v1:${canonical(value)}`)))).map(n => n.toString(16).padStart(2, "0")).join("");
  const digest = await digestOf(batch);
  const ack = (status: string) => request.headers.get("x-db-traffic-protocol") === "2"
    ? Response.json({ protocol: 2, id: batch.id, digest, status }) : new Response(null, { status: 204 });
  const existing = await env.DB.prepare("SELECT digest,status FROM db_traffic_receipts WHERE id=?").bind(batch.id).first<{ digest: string; status: string }>();
  if (existing) return existing.digest === digest ? ack(existing.status) : new Response(null, { status: 409 });
  // Receipts were introduced after the normal table; reconstruct legacy identity.
  const old = await env.DB.prepare("SELECT id,at,process,release,deployment,payload,dropped,received_bytes,connections,observed_connections FROM db_traffic_batches WHERE id=?").bind(batch.id).first<{ id: string; at: number; process: string; release: string; deployment: string; payload: string; dropped: number; received_bytes: number; connections: number; observed_connections: number }>();
  if (old) {
    const payload = JSON.parse(old.payload);
    const reconstructed = { id: old.id, at: old.at, process: old.process, release: old.release, deployment: old.deployment, dropped: old.dropped, receivedBytes: old.received_bytes, connections: old.connections, observedConnections: old.observed_connections, ...(Array.isArray(payload) ? { rows: payload } : payload) };
    return await digestOf(reconstructed) === digest ? ack("accepted") : new Response(null, { status: 409 });
  }
  if (batch.at < now - DAY) return reject("timestamp_old", now, 410);
  const day = new Date(now).toISOString().slice(0, 10);
  const status = reasons.length ? "quarantined" : "accepted";
  const payload = JSON.stringify(newBatch ? { rows: batch.rows, remainingRxBytes: batch.remainingRxBytes, remaining: batch.remaining, ...(lossProvided ? { droppedReceivedBytes: batch.droppedReceivedBytes, unconfirmedReceivedBytes: batch.unconfirmedReceivedBytes, unconfirmedBatches: batch.unconfirmedBatches } : {}) } : batch.rows);
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO db_traffic_usage(day,batches) VALUES(?,0)").bind(day),
    env.DB.prepare("INSERT OR IGNORE INTO db_traffic_receipts(id,digest,status,at,release,deployment,payload,reasons,expires) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT batches FROM db_traffic_usage WHERE day=?)<5000 AND NOT EXISTS (SELECT 1 FROM db_traffic_batches WHERE id=?)").bind(batch.id,digest,status,batch.at,batch.release,batch.deployment,reasons.length ? JSON.stringify(batch) : null,reasons.length ? JSON.stringify(reasons) : null,batch.at + 7 * DAY,day,batch.id),
    env.DB.prepare("UPDATE db_traffic_usage SET batches=batches+1 WHERE day=? AND changes()=1").bind(day),
    env.DB.prepare("INSERT OR IGNORE INTO db_traffic_batches(id,at,process,release,deployment,payload,expires,dropped,received_bytes,connections,observed_connections) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM db_traffic_receipts WHERE id=? AND digest=? AND status='accepted')").bind(batch.id,batch.at,batch.process,batch.release,batch.deployment,payload,batch.at + 7 * DAY,batch.dropped,batch.receivedBytes,batch.connections,batch.observedConnections,batch.id,digest),
  ]);
  const stored = await env.DB.prepare("SELECT digest,status FROM db_traffic_receipts WHERE id=?").bind(batch.id).first<{ digest: string; status: string }>();
  if (!stored) return new Response(null, { status: 429, headers: { "retry-after": String(Math.ceil((Date.parse(day + "T00:00:00Z") + DAY - now) / 1000)), "x-db-traffic-limit": "daily" } });
  if (stored.digest !== digest) return new Response(null, { status: 409 });
  try { if (stored.status === "accepted") await maintainDbTraffic(env, now, 1); else await maintainDbTrafficQuality(env, now, 1); } catch { /* Retry by maintenance. */ }
  return ack(stored.status);
}
export async function readDbTraffic(env: Env, now: number, hours: 24 | 72, selection?: TrafficSelection) {
  const rollup = await readDbTrafficHours(env, now, hours, selection);
  const offline = await env.DB.prepare("SELECT payload FROM db_offline_runs WHERE ended>=? AND ended<=? AND expires>? ORDER BY ended DESC LIMIT 101").bind(rollup.start, now, now).all<{ payload: string }>();
  return { ...rollup, offline: offline.results.slice(0, 100).map(row => JSON.parse(row.payload)), offlineTruncated: offline.results.length > 100, generatedAt: now };
}

export async function ingestOffline(request: Request, env: Env, now: number): Promise<Response> {
  if ((env.DB_TRAFFIC_KEY?.length ?? 0) < 32 || request.headers.get("authorization") !== `Bearer ${env.DB_TRAFFIC_KEY}`) return new Response(null, { status: 401 });
  if (env.ACCEPTING !== "1" || env.RETENTION_APPROVED !== "1") return new Response(null, { status: 503 });
  const reader = request.body?.getReader(); if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = []; let length = 0;
  for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > 2048) { await reader.cancel(); return new Response(null, { status: 413 }); } chunks.push(part.value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const body = new TextDecoder().decode(bytes);
  let value: { consumer: string; run: string; release: string; started: number; ended: number; status: string; rows: number | null; logicalBytes: number | null; dumpBytes: number | null; snapshotBytes: number | null; artifactBytes: number | null; storageBytes: number | null };
  try { value = JSON.parse(body); } catch { return new Response(null, { status: 400 }); }
  const size = (v: unknown) => v === null || (Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 1e12);
  if (!value || Object.keys(value).sort().join() !== "artifactBytes,consumer,dumpBytes,ended,logicalBytes,release,rows,run,snapshotBytes,started,status,storageBytes" || !["preview", "recovery-full", "recovery-db-checkpoint"].includes(value.consumer) || !/^[A-Za-z0-9._-]{1,80}$/.test(value.run) || !/^[A-Za-z0-9._-]{1,80}$/.test(value.release) || !["exported", "skipped"].includes(value.status) || !Number.isSafeInteger(value.started) || !Number.isSafeInteger(value.ended) || value.started > value.ended || value.ended < now - DAY || value.ended > now + 60000 || ![value.rows, value.logicalBytes, value.dumpBytes, value.snapshotBytes, value.artifactBytes, value.storageBytes].every(size)) return new Response(null, { status: 400 });
  const day = new Date(now).toISOString().slice(0, 10);
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO db_traffic_usage(day,batches) VALUES(?,0)").bind(day),
    env.DB.prepare("INSERT OR IGNORE INTO db_offline_runs(consumer,run,started,ended,release,payload,expires) SELECT ?,?,?,?,?,?,? WHERE (SELECT batches FROM db_traffic_usage WHERE day=?)<5000").bind(value.consumer, value.run, value.started, value.ended, value.release, body, value.ended + 7 * DAY, day),
    env.DB.prepare("UPDATE db_traffic_usage SET batches=batches+1 WHERE day=? AND changes()=1").bind(day),
  ]);
  const stored = await env.DB.prepare("SELECT run FROM db_offline_runs WHERE consumer=? AND run=?").bind(value.consumer, value.run).first();
  return new Response(null, { status: stored ? 204 : 429 });
}

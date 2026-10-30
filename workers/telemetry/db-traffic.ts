import type { Env } from "./index";
import { maintainDbTraffic, readDbTrafficHours, type TrafficSelection } from "./db-traffic-rollup";

import { DB_SOURCES, DB_TEMPLATE_PATTERN } from "../../src/lib/observability/db-traffic-contract";
const sources = new Set<string>(DB_SOURCES);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 86400000;
export async function ingestDbTraffic(request: Request, env: Env, now: number): Promise<Response> {
  if ((env.DB_TRAFFIC_KEY?.length ?? 0) < 32 || request.headers.get("authorization") !== `Bearer ${env.DB_TRAFFIC_KEY}`) return new Response(null, { status: 401 });
  if (env.ACCEPTING !== "1" || env.RETENTION_APPROVED !== "1") return new Response(null, { status: 503 });
  const reader = request.body?.getReader(); if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 40000) { await reader.cancel(); return new Response(null, { status: 413 }); } chunks.push(part.value); }
  type SkipReasons = { budget: number; unsupported_value: number; error: number };
  type Row = { source: string; template: string; queries: number; failures: number; rows: number; queryMs: number; logicalRowJsonBytes?: number; logicalMeasuredQueries?: number; rxBytes?: number; skipReasons?: SkipReasons };
  type Remaining = { async: number; no_owner: number; partial: number; unsupported: number; instrumentation: number };
  let batch: { id: string; process: string; at: number; release: string; deployment: string; dropped: number; receivedBytes: number; connections: number; observedConnections: number; rows: Row[]; remainingRxBytes?: number; remaining?: Remaining; droppedReceivedBytes?: number; unconfirmedReceivedBytes?: number; unconfirmedBatches?: number };
  try { const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } batch = JSON.parse(new TextDecoder().decode(bytes)); } catch { return new Response(null, { status: 400 }); }
  if (!batch || typeof batch !== "object" || Array.isArray(batch)) return new Response(null, { status: 400 });
  const validNumber = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1e12;
  const integer = (n: unknown) => validNumber(n) && Number.isSafeInteger(n);
  const keys = (value: unknown, expected: string) => !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join() === expected;
  const oldBatch = keys(batch, "at,connections,deployment,dropped,id,observedConnections,process,receivedBytes,release,rows");
  const newBatch = keys(batch, "at,connections,deployment,dropped,id,observedConnections,process,receivedBytes,release,remaining,remainingRxBytes,rows") || keys(batch, "at,connections,deployment,dropped,droppedReceivedBytes,id,observedConnections,process,receivedBytes,release,remaining,remainingRxBytes,rows,unconfirmedBatches,unconfirmedReceivedBytes");
  const lossProvided = batch.droppedReceivedBytes !== undefined || batch.unconfirmedReceivedBytes !== undefined || batch.unconfirmedBatches !== undefined;
  if (lossProvided && (!integer(batch.droppedReceivedBytes) || !integer(batch.unconfirmedReceivedBytes) || !integer(batch.unconfirmedBatches))) return new Response(null, { status: 400 });
  if ((!oldBatch && !newBatch) || !integer(batch.dropped) || batch.dropped > 1000000 || !integer(batch.receivedBytes) || !integer(batch.connections) || batch.connections > 1000 || !integer(batch.observedConnections) || batch.observedConnections > batch.connections || typeof batch.id !== "string" || typeof batch.process !== "string" || !uuid.test(batch.id) || !uuid.test(batch.process) || !Number.isSafeInteger(batch.at) || batch.at < now - DAY || batch.at > now + 60000 || typeof batch.release !== "string" || typeof batch.deployment !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(batch.release) || !/^[A-Za-z0-9._-]{1,80}$/.test(batch.deployment) || !Array.isArray(batch.rows) || batch.rows.length > 80 + DB_SOURCES.length) return new Response(null, { status: 400 });
  const validRow = (row: Row) => {
    const legacy = keys(row, "failures,queries,queryMs,rows,source,template") || keys(row, "failures,logicalMeasuredQueries,logicalRowJsonBytes,queries,queryMs,rows,source,template");
    const current = keys(row, "failures,logicalMeasuredQueries,logicalRowJsonBytes,queries,queryMs,rows,rxBytes,skipReasons,source,template");
    if (!(newBatch ? current : legacy) || !sources.has(row.source) || !DB_TEMPLATE_PATTERN.test(row.template) || !integer(row.queries) || !integer(row.failures) || !integer(row.rows) || !validNumber(row.queryMs) || row.failures > row.queries) return false;
    if (row.logicalRowJsonBytes !== undefined && (!integer(row.logicalRowJsonBytes) || !integer(row.logicalMeasuredQueries) || row.logicalMeasuredQueries! > row.queries)) return false;
    if (current && (!integer(row.rxBytes) || !keys(row.skipReasons, "budget,error,unsupported_value") || !Object.values(row.skipReasons!).every(integer) || Object.values(row.skipReasons!).reduce((sum, n) => sum + n, 0) + row.logicalMeasuredQueries! > row.queries)) return false;
    return true;
  };
  if (!batch.rows.every(validRow)) return new Response(null, { status: 400 });
  if (newBatch && (!keys(batch.remaining, "async,instrumentation,no_owner,partial,unsupported") || !Object.values(batch.remaining!).every(integer) || !integer(batch.remainingRxBytes) || Object.values(batch.remaining!).reduce((sum, n) => sum + n, 0) !== batch.remainingRxBytes || batch.rows.reduce((sum, row) => sum + row.rxBytes!, 0) + batch.remainingRxBytes! !== batch.receivedBytes)) return new Response(null, { status: 400 });
  const day = new Date(now).toISOString().slice(0, 10);
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO db_traffic_usage(day,batches) VALUES(?,0)").bind(day),
    env.DB.prepare("INSERT OR IGNORE INTO db_traffic_batches(id,at,process,release,deployment,payload,expires,dropped,received_bytes,connections,observed_connections) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT batches FROM db_traffic_usage WHERE day=?)<5000").bind(batch.id, batch.at, batch.process, batch.release, batch.deployment, JSON.stringify(newBatch ? { rows: batch.rows, remainingRxBytes: batch.remainingRxBytes, remaining: batch.remaining, ...(lossProvided ? { droppedReceivedBytes: batch.droppedReceivedBytes, unconfirmedReceivedBytes: batch.unconfirmedReceivedBytes, unconfirmedBatches: batch.unconfirmedBatches } : {}) } : batch.rows), batch.at + 7 * DAY, batch.dropped, batch.receivedBytes, batch.connections, batch.observedConnections, day),
    env.DB.prepare("UPDATE db_traffic_usage SET batches=batches+1 WHERE day=? AND changes()=1").bind(day),
  ]);
  const stored = await env.DB.prepare("SELECT id FROM db_traffic_batches WHERE id=?").bind(batch.id).first();
  if (stored) {
    // Make progress during normal traffic; a failed rollup never rejects an accepted batch.
    try { await maintainDbTraffic(env, now, 1); } catch { /* The queued batch remains available for hourly retry. */ }
  }
  return new Response(null, { status: stored ? 204 : 429 });
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

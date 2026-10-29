import type { Env } from "./index";

import { DB_SOURCES, DB_TEMPLATE_PATTERN } from "../../src/lib/observability/db-traffic-contract";
const sources = new Set<string>(DB_SOURCES);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 86400000;
export async function ingestDbTraffic(request: Request, env: Env, now: number): Promise<Response> {
  if ((env.DB_TRAFFIC_KEY?.length ?? 0) < 32 || request.headers.get("authorization") !== `Bearer ${env.DB_TRAFFIC_KEY}`) return new Response(null, { status: 401 });
  if (env.ACCEPTING !== "1" || env.RETENTION_APPROVED !== "1") return new Response(null, { status: 503 });
  const reader = request.body?.getReader(); if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 24000) { await reader.cancel(); return new Response(null, { status: 413 }); } chunks.push(part.value); }
  let batch: { id: string; process: string; at: number; release: string; deployment: string; dropped: number; receivedBytes: number; connections: number; observedConnections: number; rows: Array<{ source: string; template: string; queries: number; failures: number; rows: number; queryMs: number }> };
  try { const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } batch = JSON.parse(new TextDecoder().decode(bytes)); } catch { return new Response(null, { status: 400 }); }
  const validNumber = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1e12;
  if (!batch || Object.keys(batch).sort().join() !== "at,connections,deployment,dropped,id,observedConnections,process,receivedBytes,release,rows" || !Number.isSafeInteger(batch.dropped) || batch.dropped < 0 || batch.dropped > 1000000 || !Number.isSafeInteger(batch.receivedBytes) || batch.receivedBytes < 0 || batch.receivedBytes > 1e12 || !Number.isSafeInteger(batch.connections) || batch.connections < 0 || batch.connections > 1000 || !Number.isSafeInteger(batch.observedConnections) || batch.observedConnections < 0 || batch.observedConnections > batch.connections || !uuid.test(batch.id) || !uuid.test(batch.process) || !Number.isSafeInteger(batch.at) || batch.at < now - DAY || batch.at > now + 60000 || !/^[A-Za-z0-9._-]{1,80}$/.test(batch.release) || !/^[A-Za-z0-9._-]{1,80}$/.test(batch.deployment) || !Array.isArray(batch.rows) || batch.rows.length > 113 || !batch.rows.every(row => row && Object.keys(row).sort().join() === "failures,queries,queryMs,rows,source,template" && sources.has(row.source) && DB_TEMPLATE_PATTERN.test(row.template) && [row.queries, row.failures, row.rows, row.queryMs].every(validNumber) && Number.isSafeInteger(row.queries) && Number.isSafeInteger(row.failures) && Number.isSafeInteger(row.rows) && row.failures <= row.queries)) return new Response(null, { status: 400 });
  const day = new Date(now).toISOString().slice(0, 10);
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO db_traffic_usage(day,batches) VALUES(?,0)").bind(day),
    env.DB.prepare("INSERT OR IGNORE INTO db_traffic_batches(id,at,process,release,deployment,payload,expires,dropped,received_bytes,connections,observed_connections) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT batches FROM db_traffic_usage WHERE day=?)<5000").bind(batch.id, batch.at, batch.process, batch.release, batch.deployment, JSON.stringify(batch.rows), batch.at + 7 * DAY, batch.dropped, batch.receivedBytes, batch.connections, batch.observedConnections, day),
    env.DB.prepare("UPDATE db_traffic_usage SET batches=batches+1 WHERE day=? AND changes()=1").bind(day),
  ]);
  const stored = await env.DB.prepare("SELECT id FROM db_traffic_batches WHERE id=?").bind(batch.id).first();
  return new Response(null, { status: stored ? 204 : 429 });
}
export async function readDbTraffic(env: Env, now: number, hours: 24 | 72) {
  const from = now - hours * 3600000;
  const totals = await env.DB.prepare(`SELECT json_extract(j.value,'$.source') AS source, json_extract(j.value,'$.template') AS template,
    sum(json_extract(j.value,'$.queries')) AS queries, sum(json_extract(j.value,'$.failures')) AS failures,
    sum(json_extract(j.value,'$.rows')) AS rows, sum(json_extract(j.value,'$.queryMs')) AS queryMs
    FROM db_traffic_batches b,json_each(b.payload) j WHERE b.at>=? AND b.at<=? AND b.expires>? GROUP BY 1,2 ORDER BY queries DESC LIMIT 20`).bind(from, now, now).all();
  const sourceTotals = await env.DB.prepare(`SELECT json_extract(j.value,'$.source') AS source, sum(json_extract(j.value,'$.queries')) AS queries, sum(CASE WHEN json_extract(j.value,'$.template')='unsupported' THEN json_extract(j.value,'$.queries') ELSE 0 END) AS unsupported, sum(CASE WHEN json_extract(j.value,'$.template')='overflow' THEN json_extract(j.value,'$.queries') ELSE 0 END) AS overflow FROM db_traffic_batches b,json_each(b.payload) j WHERE b.at>=? AND b.at<=? AND b.expires>? GROUP BY 1 ORDER BY 2 DESC`).bind(from, now, now).all();
  const hourly = await env.DB.prepare(`WITH traffic AS (
    SELECT CAST(at / 3600000 AS INTEGER) * 3600000 AS hour, release, deployment, count(*) AS batches,
      count(DISTINCT process) AS processes, sum(received_bytes) AS receivedBytes
    FROM db_traffic_batches WHERE at>=? AND at<=? AND expires>? GROUP BY 1,2,3
  ), query_counts AS (
    SELECT CAST(b.at / 3600000 AS INTEGER) * 3600000 AS hour, b.release, b.deployment,
      sum(json_extract(j.value,'$.queries')) AS queries, sum(json_extract(j.value,'$.rows')) AS rows
    FROM db_traffic_batches b,json_each(b.payload) j WHERE b.at>=? AND b.at<=? AND b.expires>? GROUP BY 1,2,3
  ) SELECT t.*, coalesce(q.queries,0) AS queries, coalesce(q.rows,0) AS rows FROM traffic t
    LEFT JOIN query_counts q ON q.hour=t.hour AND q.release=t.release AND q.deployment=t.deployment
    ORDER BY t.hour DESC LIMIT 1001`).bind(from, now, now, from, now, now).all();
  const coverage = await env.DB.prepare("SELECT coalesce(sum(dropped),0) AS dropped, coalesce(sum(received_bytes),0) AS receivedBytes, coalesce(sum(connections),0) AS connections, coalesce(sum(observed_connections),0) AS observedConnections FROM db_traffic_batches WHERE at>=? AND at<=? AND expires>?").bind(from, now, now).first();
  const offline = await env.DB.prepare("SELECT payload FROM db_offline_runs WHERE ended>=? AND ended<=? AND expires>? ORDER BY ended DESC LIMIT 101").bind(from, now, now).all<{ payload: string }>();
  return { offline: offline.results.slice(0, 100).map(row => JSON.parse(row.payload)), offlineTruncated: offline.results.length > 100, totals: totals.results, sources: sourceTotals.results, hours: hourly.results.slice(0, 1000), truncated: hourly.results.length > 1000, dropped: coverage?.dropped ?? 0, receivedBytes: coverage?.receivedBytes ?? 0, connections: coverage?.connections ?? 0, observedConnections: coverage?.observedConnections ?? 0, generatedAt: now };
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

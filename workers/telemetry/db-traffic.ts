import type { Env } from "./index";

const sources = new Set(["mizar", "dak", "scheduler", "stats.fill", "bet.fill", "unknown"]);
const templates = new Set(["select", "with", "insert", "update", "delete", "begin", "commit", "rollback", "rollback_to", "set", "savepoint", "release", "unknown", "unsupported"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 86400000;
export async function ingestDbTraffic(request: Request, env: Env, now: number): Promise<Response> {
  if ((env.DB_TRAFFIC_KEY?.length ?? 0) < 32 || request.headers.get("authorization") !== `Bearer ${env.DB_TRAFFIC_KEY}`) return new Response(null, { status: 401 });
  if (env.ACCEPTING !== "1" || env.RETENTION_APPROVED !== "1") return new Response(null, { status: 503 });
  const reader = request.body?.getReader(); if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 24000) { await reader.cancel(); return new Response(null, { status: 413 }); } chunks.push(part.value); }
  let batch: { id: string; process: string; at: number; release: string; deployment: string; dropped: number; rows: Array<{ source: string; template: string; queries: number; failures: number; rows: number; queryMs: number }> };
  try { const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } batch = JSON.parse(new TextDecoder().decode(bytes)); } catch { return new Response(null, { status: 400 }); }
  const validNumber = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1e12;
  if (!batch || Object.keys(batch).sort().join() !== "at,deployment,dropped,id,process,release,rows" || !Number.isSafeInteger(batch.dropped) || batch.dropped < 0 || batch.dropped > 1000000 || !uuid.test(batch.id) || !uuid.test(batch.process) || !Number.isSafeInteger(batch.at) || batch.at < now - DAY || batch.at > now + 60000 || !/^[A-Za-z0-9._-]{1,80}$/.test(batch.release) || !/^[A-Za-z0-9._-]{1,80}$/.test(batch.deployment) || !Array.isArray(batch.rows) || !batch.rows.length || batch.rows.length > 84 || !batch.rows.every(row => row && Object.keys(row).sort().join() === "failures,queries,queryMs,rows,source,template" && sources.has(row.source) && templates.has(row.template) && [row.queries, row.failures, row.rows, row.queryMs].every(validNumber) && Number.isSafeInteger(row.queries) && Number.isSafeInteger(row.failures) && Number.isSafeInteger(row.rows) && row.failures <= row.queries)) return new Response(null, { status: 400 });
  const day = new Date(now).toISOString().slice(0, 10);
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO db_traffic_usage(day,batches) VALUES(?,0)").bind(day),
    env.DB.prepare("INSERT OR IGNORE INTO db_traffic_batches(id,at,process,release,deployment,payload,expires,dropped) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT batches FROM db_traffic_usage WHERE day=?)<5000").bind(batch.id, batch.at, batch.process, batch.release, batch.deployment, JSON.stringify(batch.rows), batch.at + 7 * DAY, batch.dropped, day),
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
    FROM db_traffic_batches b,json_each(b.payload) j WHERE b.at>=? AND b.expires>? GROUP BY 1,2 ORDER BY queries DESC`).bind(from, now).all();
  const hourly = await env.DB.prepare(`SELECT CAST(at / 3600000 AS INTEGER) * 3600000 AS hour, release, deployment,
    count(DISTINCT b.id) AS batches, count(DISTINCT b.process) AS processes, sum(json_extract(j.value,'$.queries')) AS queries, sum(json_extract(j.value,'$.rows')) AS rows FROM db_traffic_batches b,json_each(b.payload) j WHERE b.at>=? AND b.expires>? GROUP BY 1,2,3 ORDER BY 1 DESC LIMIT 1001`).bind(from, now).all();
  const coverage = await env.DB.prepare("SELECT coalesce(sum(dropped),0) AS dropped FROM db_traffic_batches WHERE at>=? AND expires>?").bind(from, now).first();
  return { totals: totals.results, hours: hourly.results.slice(0, 1000), truncated: hourly.results.length > 1000, dropped: coverage?.dropped ?? 0, generatedAt: now };
}

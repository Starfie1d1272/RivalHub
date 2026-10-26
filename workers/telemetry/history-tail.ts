import type { Database } from "./index";
import { sample, type Sample } from "./history";
import { decompressEvents } from "./storage";
import { LIMITS, validEvent, type TelemetryEvent } from "../../src/lib/telemetry/protocol";
import { emptyHistoryDistribution, type HistoryQuery, type HistoryRow } from "../../src/lib/telemetry/history-contract";

interface Cursor { cursor_received: number; cursor_ticket: string; cursor_id: string }
interface Batch { ticket: string; id: string; received: number; expires: number; account: string | null; role: string; release: string; bytes: number; events_gzip: Uint8Array }
const MAX_BATCHES = 16, MAX_BYTES = 384 * 1024, MAX_GROUPS = 8192, MAX_PAYLOAD = 1536 * 1024;
const columns = { key: "sample_key", day: "day", kind: "kind", dimensions: "dimensions", at: "latest_at", received: "received", expires: "expires", closes: "closes", start: "has_start", phase: "phase", value: "value", bucket: "bucket", active: "active", activeBucket: "active_bucket", client: "client_covered", enhanced: "enhanced_covered" } as const;
/** Same correction precedence as history's persisted upsert; query overlay never writes. */
function merge(old: Sample | undefined, next: Sample, now: number): Sample {
  if (!old) return next;
  if (next.received > old.closes || old.expires <= now) return old;
  const confirmed = old.kind === "task" && old.phase === "complete";
  const newConfirmation = next.kind === "task" && next.phase === "complete" && !confirmed;
  const latest = newConfirmation || !confirmed && next.at >= old.at;
  const terminal = next.phase !== "pending";
  const replaceValue = latest && (terminal || !["operation", "task"].includes(next.kind));
  const firstStart = next.start === 1 && old.start === 0;
  const previousDimensions = JSON.parse(old.dimensions), incomingDimensions = JSON.parse(next.dimensions);
  const dimensions = firstStart ? incomingDimensions : previousDimensions;
  for (const flag of ["elapsedCensored", "activeCensored"]) if (flag in incomingDimensions || flag in previousDimensions) dimensions[flag] = !!(terminal && latest ? incomingDimensions[flag] : previousDimensions[flag]);
  return { ...old,
    day: firstStart ? next.day : old.start ? old.day : [old.day, next.day].sort()[0],
    closes: firstStart ? next.closes : old.start ? old.closes : Math.min(old.closes, next.closes),
    dimensions: JSON.stringify(dimensions),
    expires: Math.min(old.expires, next.expires), start: Math.max(old.start, next.start),
    phase: terminal && latest ? next.phase : old.phase,
    value: replaceValue ? next.value : old.value, bucket: replaceValue ? next.bucket : old.bucket,
    active: latest && (next.active !== null || next.kind === "task" && next.phase === "complete") ? next.active : old.active,
    activeBucket: latest && (next.active !== null || next.kind === "task" && next.phase === "complete") ? next.activeBucket : old.activeBucket,
    at: Math.max(old.at, next.at), received: Math.max(old.received, next.received),
    client: Math.max(old.client, next.client), enhanced: Math.max(old.enhanced, next.enhanced),
  };
}
/** Mutable cohorts come from deduplicated samples plus a bounded unprocessed tail, never stale daily payloads. */
export async function readHistoryTail(db: Database, state: Cursor, from: string, to: string, now: number, filters: HistoryQuery) {
  const batches = await db.prepare(`SELECT ticket,id,received,expires,account,role,release,bytes,events_gzip FROM batches WHERE environment='production' AND expires>? AND received<=? AND (received>? OR (received=? AND (ticket>? OR (ticket=? AND id>?)))) ORDER BY received,ticket,id LIMIT ?`)
    .bind(now, now, state.cursor_received, state.cursor_received, state.cursor_ticket, state.cursor_ticket, state.cursor_id, MAX_BATCHES + 1).all<Batch>();
  const projected: Sample[] = []; let bytes = 0, count = 0;
  for (const b of batches.results.slice(0, MAX_BATCHES)) {
    if (bytes + b.bytes > MAX_BYTES) break;
    const body = await decompressEvents(b.events_gzip); bytes += new TextEncoder().encode(body).byteLength;
    if (bytes > MAX_BYTES) break;
    const raw: unknown = JSON.parse(body);
    if (!Array.isArray(raw) || raw.length > LIMITS.batch || raw.some(e => !validEvent(e, e.at))) throw new Error("Invalid history tail");
    for (const e of raw as TelemetryEvent[]) projected.push(await sample(e, b));
    count++;
  }
  const keys = JSON.stringify([...new Set(projected.map(s => s.key))]);
  const existing = await db.prepare(`SELECT ${Object.entries(columns).map(([key, column]) => `${column} AS "${key}"`).join(",")} FROM history_samples WHERE sample_key IN (SELECT value FROM json_each(?))`).bind(keys).all<Sample>();
  const updated = new Map(existing.results.map(s => [s.key, s]));
  for (const s of projected) updated.set(s.key, merge(updated.get(s.key), s, now));
  const overlay = JSON.stringify([...updated.values()]);
  const source = `WITH samples AS (SELECT * FROM history_samples WHERE expires>? AND day>=? AND day<=? AND sample_key NOT IN (SELECT value FROM json_each(?)) UNION ALL SELECT ${Object.entries(columns).map(([key]) => `json_extract(value,'$.${key}')`).join(",")} FROM json_each(?) WHERE json_extract(value,'$.expires')>?)`;
  // UNION columns follow table order, declared explicitly below rather than schema order.
  const explicitSource = source.replace("SELECT * FROM history_samples", `SELECT ${Object.values(columns).join(",")} FROM history_samples`);
  const conditions: string[] = []; const values: string[] = [];
  for (const key of ["scene", "role", "route", "device", "release", "eventId", "task"] as const) if (filters[key]) { conditions.push(`json_extract(dimensions,'$.${key}')=?`); values.push(filters[key]); }
  if (filters.operation) { conditions.push("kind='operation' AND json_extract(dimensions,'$.name')=?"); values.push(filters.operation); }
  const groups = await db.prepare(`${explicitSource} SELECT day,dimensions,phase,bucket,active_bucket,count(*) n,sum(has_start) starts,sum(client_covered) client,sum(enhanced_covered) enhanced,
    count(CASE WHEN kind NOT IN ('operation','task') OR has_start=1 THEN value END) value_n,
    sum(CASE WHEN kind NOT IN ('operation','task') OR has_start=1 THEN value END) value_sum,
    min(CASE WHEN kind NOT IN ('operation','task') OR has_start=1 THEN value END) value_min,
    max(CASE WHEN kind NOT IN ('operation','task') OR has_start=1 THEN value END) value_max,
    count(CASE WHEN has_start=1 AND phase='complete' THEN active END) active_n,
    sum(CASE WHEN has_start=1 AND phase='complete' THEN active END) active_sum,
    min(CASE WHEN has_start=1 AND phase='complete' THEN active END) active_min,
    max(CASE WHEN has_start=1 AND phase='complete' THEN active END) active_max
    FROM samples WHERE day>=? AND day<=? AND day NOT IN (SELECT day FROM history_days WHERE sealed=1) ${conditions.length ? "AND " + conditions.join(" AND ") : ""} GROUP BY day,dimensions,phase,bucket,active_bucket ORDER BY day,dimensions,phase,bucket,active_bucket LIMIT ?`)
    .bind(now, from, to, keys, overlay, now, from, to, ...values, MAX_GROUPS + 1).all<Record<string, string | number | null>>();
  const days = new Map<string, Map<string, HistoryRow>>();
  for (const g of groups.results.slice(0, MAX_GROUPS)) {
    const dimensions = JSON.parse(String(g.dimensions));
    for (const flag of ["elapsedCensored", "activeCensored"]) if (flag in dimensions) dimensions[flag] = !!dimensions[flag];
    const day = String(g.day); const rows = days.get(day) ?? new Map<string, HistoryRow>(); days.set(day, rows);
    const key = String(g.dimensions) + ":" + g.phase;
    const r: HistoryRow = rows.get(key) ?? { ...dimensions, phase: g.phase, n: 0, starts: 0, clientCovered: 0, enhancedCovered: 0, duration: emptyHistoryDistribution(dimensions.name), active: emptyHistoryDistribution() };
    r.n += Number(g.n); r.starts += Number(g.starts); r.clientCovered += Number(g.client); r.enhancedCovered += Number(g.enhanced);
    for (const [metric, column, index] of [["duration", "value", "bucket"], ["active", "active", "active_bucket"]] as const) {
      const d = r[metric]; const n = Number(g[column + "_n"]); d.n += n; d.sum += Number(g[column + "_sum"] ?? 0);
      d.counts[Number(g[index])] += n;
      const min = g[column + "_min"] as number | null, max = g[column + "_max"] as number | null;
      if (min !== null) d.min = d.min === null ? min : Math.min(d.min, min);
      if (max !== null) d.max = d.max === null ? max : Math.max(d.max, max);
    }
    rows.set(key, r);
  }
  const payload = JSON.stringify([...days].map(([day, rows]) => ({ day, payload: JSON.stringify([...rows.values()]) })));
  const truncated = count < batches.results.length || groups.results.length > MAX_GROUPS || new TextEncoder().encode(payload).byteLength > MAX_PAYLOAD;
  return { payload: new TextEncoder().encode(payload).byteLength > MAX_PAYLOAD ? "[]" : payload, batches: count, bytes, truncated };
}

import { maintainDbTraffic } from "./db-traffic-rollup";
import { ingestDbTraffic, readDbTraffic, ingestOffline } from "./db-traffic";
import { LIMITS, UUID, validEvent, type TelemetryEvent } from "../../src/lib/telemetry/protocol";
import { verifyTicket } from "../../src/lib/telemetry/ticket";
import { parseDashboardFilters } from "../../src/lib/telemetry/dashboard-query";
import { dashboard } from "./dashboard";
import { longWindowSummary } from "./long-window";
import { analysis } from "./analysis";
import { parseAnalysisQuery } from "../../src/lib/telemetry/analysis-query";
import { batchSummary, compressEvents, decompressEvents } from "./storage";
import { parseHistoryQuery } from "../../src/lib/telemetry/history-contract";
import { maintainHistory, readHistory } from "./history";

export interface Statement {
  bind(...args: (string | number | null | ArrayBuffer)[]): Statement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; meta?: Record<string, number> }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta?: Record<string, number> }>;
}
export interface Database { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<unknown[]> }
export interface Env {
  DB: Database; SIGNING_KEY: string; ADMIN_KEY: string; ALLOWED_ORIGIN: string;
  DASHBOARD_KEY?: string; DB_TRAFFIC_KEY?: string;
  ACCEPTING?: string; RETENTION_APPROVED?: string; SUMMARY_RETENTION_DAYS?: string; HISTORY_RETENTION_DAYS?: string;
}
const DAY = 86400000;
// Deliberately below Workers Free/D1 allowances. Shared account headroom still needs approval.
export const BUDGET = { batches: 5000, bytes: 8 * 1024 * 1024, ticketBatchesPerHour: 120 };
const CLEANUP = { chunk: 500, maxBatches: 5000 };
function summaryRetention(env: Env): number | null {
  const days = Number(env.SUMMARY_RETENTION_DAYS);
  return Number.isInteger(days) && days >= 1 && days <= 90 ? days : null;
}
function response(status: number, origin?: string, value?: unknown) {
  return new Response(value === undefined ? null : JSON.stringify(value), { status, headers: {
    "Cache-Control": "no-store", ...(value === undefined ? {} : { "Content-Type": "application/json" }),
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  } });
}
async function boundedBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LIMITS.bytes) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(result);
}

export async function handle(request: Request, env: Env, now = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  try {
    if (url.pathname === "/v1/db-offline" && request.method === "POST") return await ingestOffline(request, env, now);
    if (url.pathname === "/v1/db-traffic" && request.method === "POST") return await ingestDbTraffic(request, env, now);
    if (url.pathname === "/v1/batches" && request.method === "POST") {
      if (origin !== env.ALLOWED_ORIGIN) return response(403);
      if (env.ACCEPTING !== "1" || env.RETENTION_APPROVED !== "1") return response(503, origin);
      const body = await boundedBody(request);
      if (!body) return response(413, origin);
      let input: { v: number; id: string; ticket: string; events: TelemetryEvent[] };
      try { input = JSON.parse(body); } catch { return response(400, origin); }
      if (!input || Object.keys(input).some(k => !["v", "id", "ticket", "events"].includes(k)) || input.v !== 1 || !UUID.test(input.id) || typeof input.ticket !== "string") return response(400, origin);
      const ticket = await verifyTicket(input.ticket, env.SIGNING_KEY, now);
      if (!ticket || ticket.origin !== origin) return response(401, origin);
      if (!Array.isArray(input.events) || !input.events.length || input.events.length > LIMITS.batch || !input.events.every(e => validEvent(e, now)) || input.events.some(e => e.session !== input.events[0].session) || new Set(input.events.map(e => e.id)).size !== input.events.length) return response(400, origin);
      const existing = await env.DB.prepare("SELECT id FROM batches WHERE ticket=? AND id=? AND expires>?").bind(ticket.id, input.id, now).first();
      if (existing) return response(204, origin);
      const events = JSON.stringify(input.events);
      const bytes = new TextEncoder().encode(events).byteLength;
      const compressed = await compressEvents(input.events);
      const summary = batchSummary(input.events);
      const day = new Date(now).toISOString().slice(0, 10);
      await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO usage(day) VALUES(?)").bind(day),
        env.DB.prepare(`INSERT OR IGNORE INTO batches(ticket,id,received,expires,day,account,session,role,release,environment,bytes,events_gzip,summary)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE
          (SELECT batches FROM usage WHERE day=?)<? AND (SELECT bytes FROM usage WHERE day=?)+?<=?
          AND (SELECT count(*) FROM batches WHERE ticket=? AND received>?)<? AND NOT EXISTS (SELECT 1 FROM rollups WHERE day=?)`)
          .bind(ticket.id, input.id, now, Math.min(...input.events.map(e => e.at)) + 7 * DAY, day, ticket.account, input.events[0].session, ticket.role, ticket.release, ticket.environment, bytes, compressed, summary, day, BUDGET.batches, day, bytes, BUDGET.bytes, ticket.id, now - 3600000, BUDGET.ticketBatchesPerHour, day),
        env.DB.prepare("UPDATE usage SET batches=batches+1,bytes=bytes+? WHERE day=? AND changes()=1").bind(bytes, day),
      ]);
      const accepted = await env.DB.prepare("SELECT id FROM batches WHERE ticket=? AND id=?").bind(ticket.id, input.id).first();
      return response(accepted ? 204 : 429, origin);
    }
    if (url.pathname.startsWith("/admin/")) {
      const authorization = request.headers.get("authorization");
      const operator = env.ADMIN_KEY?.length >= 32 && authorization === `Bearer ${env.ADMIN_KEY}`;
      const dashboardReader = ["/admin/dashboard", "/admin/analysis", "/admin/history", "/admin/long-window", "/admin/db-traffic"].includes(url.pathname) && (env.DASHBOARD_KEY?.length ?? 0) >= 32 && authorization === `Bearer ${env.DASHBOARD_KEY}`;
      if (!operator && !dashboardReader) return response(401);
      if (request.method !== "GET") return response(405);
      if (url.pathname === "/admin/db-traffic") {
        const hours = url.searchParams.get("hours") ?? "72";
        if (hours !== "24" && hours !== "72") return response(400);
        const hour = url.searchParams.get("hour");
        const release = url.searchParams.get("release");
        const deployment = url.searchParams.get("deployment");
        const hasSelection = hour !== null || release !== null || deployment !== null;
        if (hasSelection && (!hour || !/^\d+$/.test(hour) || !Number.isSafeInteger(Number(hour)) || Number(hour) % 3600000 !== 0 || !release || !deployment || !/^[A-Za-z0-9._-]{1,80}$/.test(release) || !/^[A-Za-z0-9._-]{1,80}$/.test(deployment))) return response(400);
        const selection = hasSelection ? { hour: Number(hour), release: release!, deployment: deployment! } : undefined;
        return response(200, undefined, await readDbTraffic(env, now, Number(hours) as 24 | 72, selection));
      }
      if (url.pathname === "/admin/history") {
        const query = parseHistoryQuery(Object.fromEntries(url.searchParams));
        if (!query) return response(400);
        return response(200, undefined, await readHistory(env, query, now));
      }
      if (url.pathname === "/admin/long-window") {
        const query = parseAnalysisQuery(Object.fromEntries(url.searchParams));
        if (!query) return response(400);
        return response(200, undefined, await longWindowSummary(env, query.filters, query.session, now, BUDGET));
      }
      if (url.pathname === "/admin/analysis") {
        const query = parseAnalysisQuery(Object.fromEntries(url.searchParams));
        if (!query) return response(400);
        return response(200, undefined, await analysis(env.DB, query.filters, query.session, now, BUDGET));
      }
      if (url.pathname === "/admin/dashboard") {
        const filters = parseDashboardFilters(Object.fromEntries(url.searchParams));
        if (!filters) return response(400);
        return response(200, undefined, await dashboard(env.DB, filters, now, BUDGET));
      }
      if (url.pathname === "/admin/events") {
        const session = url.searchParams.get("session");
        const account = url.searchParams.get("account");
        if ((!session && !account) || (session && !UUID.test(session)) || (account && !/^[A-Za-z0-9_-]{43}$/.test(account))) return response(400);
        const before = Number(url.searchParams.get("before") ?? now + 1);
        if (!Number.isFinite(before)) return response(400);
        const cursorId = url.searchParams.get("id"); const cursorTicket = url.searchParams.get("ticket");
        if ((cursorId || cursorTicket) && (!cursorId || !cursorTicket || !UUID.test(cursorId) || !UUID.test(cursorTicket))) return response(400);
        const field = session ? "session" : "account";
        const rows = await env.DB.prepare(`SELECT ticket,id,received,account,session,role,release,environment,events_gzip FROM batches
          WHERE ${field}=? AND expires>? AND (received<? OR (received=? AND (id<? OR (id=? AND ticket<?))))
          ORDER BY received DESC,id DESC,ticket DESC LIMIT 21`).bind(session ?? account!, now, before, before, cursorId ?? "", cursorId ?? "", cursorTicket ?? "").all();
        const last = rows.results[19];
        const batches = [];
        for (const row of rows.results.slice(0, 20)) {
          const { events_gzip, ...metadata } = row;
          batches.push({ ...metadata, events: await decompressEvents(events_gzip as number[] | Uint8Array) });
        }
        return response(200, undefined, { batches, truncated: rows.results.length > 20,
          nextCursor: rows.results.length > 20 ? { before: last.received, id: last.id, ticket: last.ticket } : null });
      }
      if (url.pathname === "/admin/summary") {
        const from = url.searchParams.get("from"); const to = url.searchParams.get("to");
        if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to || Date.parse(to) - Date.parse(from) > 31 * DAY) return response(400);
        const rows = await env.DB.prepare("SELECT * FROM summaries WHERE day>=? AND day<=? AND expires>? ORDER BY day,release,route LIMIT 5001").bind(from, to, now).all();
        return response(200, undefined, { rows: rows.results.slice(0, 5000), truncated: rows.results.length > 5000, newSummaryRetentionDays: summaryRetention(env) });
      }
      if (url.pathname === "/admin/usage") {
        const rows = await env.DB.prepare("SELECT * FROM usage ORDER BY day DESC LIMIT 8").all();
        const cleanup = await env.DB.prepare("SELECT count(*) AS expiredBatches,min(expires) AS oldestExpiry FROM batches WHERE expires<=?").bind(now).first();
        return response(200, undefined, { usage: rows.results, budget: BUDGET, cleanup });
      }
    }
    return response(404);
  } catch { return response(503, origin === env.ALLOWED_ORIGIN ? origin : undefined); }
}

/** Expiry commits independently before rollup, including when summary writes run out of space. */
export async function maintain(env: Env, now = Date.now()) {
  if (env.RETENTION_APPROVED !== "1") return;
  try { await maintainDbTraffic(env, now); } catch { console.warn("db_traffic_rollup_unavailable"); }
  let historyError: unknown;
  try { await maintainHistory(env, now); } catch (error) { historyError = error; }
  const today = new Date(now).toISOString().slice(0, 10);
  // Independent bounded commits drain a full daily allowance per hourly invocation.
  // A failure is surfaced by the scheduled invocation, never a global admission predicate.
  for (let deleted = 0; deleted < CLEANUP.maxBatches; deleted += CLEANUP.chunk) {
    const result = await env.DB.prepare("DELETE FROM batches WHERE (ticket,id) IN (SELECT ticket,id FROM batches WHERE expires<=? ORDER BY expires LIMIT ?)").bind(now, CLEANUP.chunk).run();
    if ((result.meta?.changes ?? CLEANUP.chunk) < CLEANUP.chunk) break;
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM db_traffic_hours WHERE expires<=?").bind(now),
    env.DB.prepare("DELETE FROM db_offline_runs WHERE (consumer,run) IN (SELECT consumer,run FROM db_offline_runs WHERE expires<=? ORDER BY expires LIMIT 500)").bind(now),
    env.DB.prepare("DELETE FROM db_traffic_batches WHERE id IN (SELECT id FROM db_traffic_batches WHERE expires<=? ORDER BY expires LIMIT 500)").bind(now),
    env.DB.prepare("DELETE FROM db_traffic_usage WHERE day<?").bind(new Date(now - 8 * DAY).toISOString().slice(0, 10)),
    env.DB.prepare("DELETE FROM rollups WHERE day<?").bind(new Date(now - 8 * DAY).toISOString().slice(0, 10)),
    env.DB.prepare("DELETE FROM usage WHERE day<?").bind(new Date(now - 8 * DAY).toISOString().slice(0, 10)),
    env.DB.prepare("DELETE FROM summaries WHERE expires<=?").bind(now),
  ]);
  if (historyError) throw historyError;
  const retention = summaryRetention(env);
  if (retention === null) return; // Raw approval never opts into durable summaries.
  const pending = await env.DB.prepare("SELECT day FROM usage WHERE day<? AND day NOT IN (SELECT day FROM rollups) ORDER BY day LIMIT 1").bind(today).first<{ day: string }>();
  if (!pending) return;
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO summaries(day,release,environment,role,scene,route,kind,operation,phase,outcome,variant,events,duration_ms,expires)
      SELECT b.day,b.release,b.environment,b.role,json_extract(e.value,'$[0]'),json_extract(e.value,'$[1]'),
        json_extract(e.value,'$[2]'),json_extract(e.value,'$[3]'),json_extract(e.value,'$[4]'),json_extract(e.value,'$[5]'),json_extract(e.value,'$[6]'),
        sum(json_extract(e.value,'$[7]')),sum(json_extract(e.value,'$[8]')),?
      FROM batches b,json_each(b.summary) e WHERE b.day=? AND b.expires>?
        AND NOT (json_extract(e.value,'$[2]')='performance' AND json_extract(e.value,'$[6]')='CLS')
      GROUP BY 1,2,3,4,5,6,7,8,9,10,11`).bind(Date.parse(pending.day) + (retention + 1) * DAY, pending.day, now),
    env.DB.prepare("INSERT INTO rollups(day) VALUES(?) ON CONFLICT DO NOTHING").bind(pending.day),
  ]);
}
const worker = { fetch: (request: Request, env: Env) => handle(request, env), scheduled: (_event: unknown, env: Env) => maintain(env) };

export default worker;

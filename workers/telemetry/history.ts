import type { Database, Env } from "./index";
import { readHistoryTail } from "./history-tail";
import { decompressEvents } from "./storage";
import { LIMITS, validEvent, type TelemetryEvent } from "../../src/lib/telemetry/protocol";
import { taskForOperation, taskForRoute } from "../../src/lib/telemetry/task-contract";
import {
  HISTORY_DAY as DAY, emptyHistoryDistribution, historyBounds, historyDay, historyDayStart,
  type HistoryData, type HistoryQuery, type HistoryRow, type HistoryTimingRow,
} from "../../src/lib/telemetry/history-contract";

const BATCH_LIMIT = 16;
const DAY_REFRESH_LIMIT = 2;
const BYTE_LIMIT = 384 * 1024;
const GROUP_LIMIT = 8192;
const DAY_PAYLOAD_BYTES = 1536 * 1024;
const TIMING_LIMIT = 512;
const CORRECTION_DAYS = 6;
interface State { started_at: number; cursor_received: number; cursor_ticket: string; cursor_id: string; last_run: number; paused_at: number | null }
interface Batch { ticket: string; id: string; received: number; expires: number; account: string | null; role: string; release: string; bytes: number; events_gzip: number[] | Uint8Array }
type Dimensions = Pick<HistoryRow, "kind" | "name" | "task" | "route" | "scene" | "role" | "device" | "release" | "eventId" | "measurementVersion" | "definitionVersion" | "navigationType" | "basis" | "elapsedCensored" | "activeCensored">;
export interface Sample { key: string; day: string; kind: string; dimensions: string; at: number; received: number; expires: number; closes: number; start: number; phase: string; value: number | null; bucket: number; active: number | null; activeBucket: number; client: number; enhanced: number }
const afterCursor = `(received>? OR (received=? AND (ticket>? OR (ticket=? AND id>?))))`;
const cursorArgs = (s: State) => [s.cursor_received, s.cursor_received, s.cursor_ticket, s.cursor_ticket, s.cursor_id];
export function historyRetention(env: Pick<Env, "HISTORY_RETENTION_DAYS">) {
  const days = Number(env.HISTORY_RETENTION_DAYS);
  return Number.isInteger(days) && days >= 1 && days <= 90 ? days : 0;
}
function bucket(value: number | null, metric = "") {
  if (value === null) return 0;
  const found = historyBounds(metric).findIndex(n => value <= n);
  return found < 0 ? historyBounds(metric).length : found;
}
export async function sample(e: TelemetryEvent, b: Batch): Promise<Sample> {
  const kind = e.kind;
  const task = e.task?.name ?? (e.operation ? taskForOperation(e.operation) : taskForRoute(e.route)) ?? "";
  const name = kind === "performance" ? e.metricName! : kind === "ready" ? `${e.ready!.module}:${e.ready!.phase}` : kind === "operation" ? e.operation! : kind === "task" ? e.task!.name : "";
  const identity = kind === "operation" ? `${e.operation}:${e.operationId}` : kind === "task" ? `${e.task!.name}:${e.task!.definitionVersion}:${e.task!.attemptId}` : kind === "ready" ? `${e.measurement?.navigationId ?? e.id}:${name}${e.ready?.basis === "demand" ? ":demand:" + e.id : ""}` : `${name}:${e.id}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`history-v1:${b.account ?? ""}:${e.session}:${kind}:${identity}`));
  const key = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, "0")).join("");
  const isStart = kind === "operation" ? e.phase === "start" : kind === "task" && e.task!.phase === "start";
  const elapsed = kind === "operation" || kind === "task" ? e.durationMs ?? 0 : 0;
  const day = historyDay(b.received - (isStart ? 0 : elapsed));
  const dimensions: Dimensions = { kind, name, task, route: e.route, scene: e.scene, role: b.role,
    device: e.client?.device ?? "missing", release: e.measurement?.clientRelease ?? "missing", eventId: e.eventId ?? "", measurementVersion: e.measurement?.v ?? 0, definitionVersion: e.task?.definitionVersion ?? 0, navigationType: e.measurement?.lifecycle?.navigationType ?? "missing", basis: e.ready ? e.ready.basis ?? "navigation" : "", elapsedCensored: kind === "task" && e.task?.elapsedCensored === true, activeCensored: kind === "task" && e.task?.activeCensored === true };
  const phase = kind === "operation" ? (e.phase === "start" ? "pending" : e.phase!) : kind === "task" ? (["complete", "cancel", "exposure"].includes(e.task!.phase) ? e.task!.phase : "pending") : "";
  const value = kind === "task" && e.task?.elapsedCensored ? null : kind === "performance" ? (name === "CLS" ? e.score! : e.durationMs!) : kind === "ready" || kind === "operation" && !isStart || kind === "task" && ["complete", "cancel"].includes(phase) ? e.durationMs ?? null : null;
  return { key, day, kind, dimensions: JSON.stringify(dimensions), at: e.at, received: b.received, expires: b.expires,
    closes: historyDayStart(day) + CORRECTION_DAYS * DAY, start: isStart ? 1 : 0, phase, value, bucket: bucket(value, name),
    active: kind === "task" && !e.task!.activeCensored ? e.task!.activeMs ?? null : null, activeBucket: bucket(kind === "task" && !e.task!.activeCensored ? e.task!.activeMs ?? null : null),
    client: e.client ? 1 : 0, enhanced: e.measurement ? 1 : 0 };
}
const confirmedTask = "(history_samples.kind='task' AND history_samples.phase='complete')";
const newConfirmation = "(excluded.kind='task' AND excluded.phase='complete' AND history_samples.phase<>'complete')";
const preferResult = `(${newConfirmation} OR (NOT ${confirmedTask} AND excluded.latest_at>=history_samples.latest_at))`;
const upsertSamples = `INSERT INTO history_samples(sample_key,day,kind,dimensions,latest_at,received,expires,closes,has_start,phase,value,bucket,active,active_bucket,client_covered,enhanced_covered)
 SELECT json_extract(value,'$.key'),json_extract(value,'$.day'),json_extract(value,'$.kind'),json_extract(value,'$.dimensions'),json_extract(value,'$.at'),json_extract(value,'$.received'),json_extract(value,'$.expires'),json_extract(value,'$.closes'),json_extract(value,'$.start'),json_extract(value,'$.phase'),json_extract(value,'$.value'),json_extract(value,'$.bucket'),json_extract(value,'$.active'),json_extract(value,'$.activeBucket'),json_extract(value,'$.client'),json_extract(value,'$.enhanced') FROM json_each(?) WHERE true
 ON CONFLICT(sample_key) DO UPDATE SET
 day=CASE WHEN excluded.has_start=1 AND history_samples.has_start=0 THEN excluded.day WHEN history_samples.has_start=1 THEN history_samples.day ELSE min(history_samples.day,excluded.day) END,
 closes=CASE WHEN excluded.has_start=1 AND history_samples.has_start=0 THEN excluded.closes WHEN history_samples.has_start=1 THEN history_samples.closes ELSE min(history_samples.closes,excluded.closes) END,expires=min(history_samples.expires,excluded.expires),
 has_start=max(history_samples.has_start,excluded.has_start),
 dimensions=json_set(CASE WHEN excluded.has_start=1 AND history_samples.has_start=0 THEN excluded.dimensions ELSE history_samples.dimensions END,
 '$.elapsedCensored',CASE WHEN ${preferResult} AND excluded.phase<>'pending' THEN coalesce(json_extract(excluded.dimensions,'$.elapsedCensored'),0) ELSE coalesce(json_extract(history_samples.dimensions,'$.elapsedCensored'),0) END,
 '$.activeCensored',CASE WHEN ${preferResult} AND excluded.phase<>'pending' THEN coalesce(json_extract(excluded.dimensions,'$.activeCensored'),0) ELSE coalesce(json_extract(history_samples.dimensions,'$.activeCensored'),0) END),
 phase=CASE WHEN excluded.phase<>'pending' AND ${preferResult} THEN excluded.phase ELSE history_samples.phase END,
 value=CASE WHEN ${preferResult} AND (excluded.phase<>'pending' OR excluded.kind NOT IN ('operation','task')) THEN excluded.value ELSE history_samples.value END,
 bucket=CASE WHEN ${preferResult} AND (excluded.phase<>'pending' OR excluded.kind NOT IN ('operation','task')) THEN excluded.bucket ELSE history_samples.bucket END,
 active=CASE WHEN ${preferResult} AND (excluded.active IS NOT NULL OR (excluded.kind='task' AND excluded.phase='complete')) THEN excluded.active ELSE history_samples.active END,
 active_bucket=CASE WHEN ${preferResult} AND (excluded.active IS NOT NULL OR (excluded.kind='task' AND excluded.phase='complete')) THEN excluded.active_bucket ELSE history_samples.active_bucket END,
 latest_at=max(history_samples.latest_at,excluded.latest_at),received=max(history_samples.received,excluded.received),
 client_covered=max(history_samples.client_covered,excluded.client_covered),enhanced_covered=max(history_samples.enhanced_covered,excluded.enhanced_covered)
 WHERE excluded.received<=history_samples.closes AND history_samples.expires>?`;

async function markGaps(db: Database, from: number, to: number, retention: number) {
  const days: string[] = [];
  for (let at = Math.max(historyDayStart(historyDay(from)), historyDayStart(historyDay(to)) - 90 * DAY); at <= to; at += DAY) days.push(historyDay(at));
  await db.prepare(`INSERT INTO history_gaps(day,expires) SELECT value,? FROM json_each(?) WHERE true ON CONFLICT(day) DO UPDATE SET expires=max(history_gaps.expires,excluded.expires)`).bind(to + retention * DAY, JSON.stringify(days)).run();
}
function pendingStatement(db: Database, state: State, now: number) {
  return db.prepare(`SELECT count(*) AS n,min(received) AS first_received FROM (SELECT received FROM batches WHERE environment='production' AND expires>? AND ${afterCursor} ORDER BY received,ticket,id LIMIT 1001)`).bind(now, ...cursorArgs(state));
}
async function pending(db: Database, state: State, now: number) {
  return await pendingStatement(db, state, now).first<{ n: number; first_received: number | null }>() ?? { n: 0, first_received: null };
}
interface Group { dimensions: string; phase: string; bucket: number; active_bucket: number; n: number; starts: number; client: number; enhanced: number; value_n: number; value_sum: number | null; value_min: number | null; value_max: number | null; active_n: number; active_sum: number | null; active_min: number | null; active_max: number | null }
async function writeDay(env: Env, day: string, state: State, firstPending: number | null, now: number, retention: number) {
  const start = historyDayStart(day), closes = start + CORRECTION_DAYS * DAY;
  const previous = await env.DB.prepare("SELECT payload,complete,sealed FROM history_days WHERE day=?").bind(day).first<{ payload: string; complete: number; sealed: number }>();
  if (previous?.sealed) return;
  if (now >= start + 7 * DAY) {
    await env.DB.prepare(`INSERT INTO history_days(day,payload,complete,sealed,captured_at,expires) VALUES(?, ?, 0, 1, ?, ?) ON CONFLICT(day) DO UPDATE SET complete=0,sealed=1,captured_at=excluded.captured_at`).bind(day, previous?.payload ?? "[]", now, start + (retention + 1) * DAY).run();
    return;
  }
  const result = await env.DB.prepare(`SELECT dimensions,phase,bucket,active_bucket,count(*) n,sum(has_start) starts,sum(client_covered) client,sum(enhanced_covered) enhanced,
    count(CASE WHEN kind NOT IN ('operation','task') OR has_start=1 THEN value END) value_n,
    sum(CASE WHEN kind NOT IN ('operation','task') OR has_start=1 THEN value END) value_sum,
    min(CASE WHEN kind NOT IN ('operation','task') OR has_start=1 THEN value END) value_min,
    max(CASE WHEN kind NOT IN ('operation','task') OR has_start=1 THEN value END) value_max,
    count(CASE WHEN has_start=1 AND phase='complete' THEN active END) active_n,
    sum(CASE WHEN has_start=1 AND phase='complete' THEN active END) active_sum,
    min(CASE WHEN has_start=1 AND phase='complete' THEN active END) active_min,
    max(CASE WHEN has_start=1 AND phase='complete' THEN active END) active_max
    FROM history_samples WHERE day=? AND expires>? GROUP BY dimensions,phase,bucket,active_bucket LIMIT ?`).bind(day, now, GROUP_LIMIT + 1).all<Group>();
  const gap = await env.DB.prepare("SELECT day FROM history_gaps WHERE day=?").bind(day).first();
  const complete = state.started_at <= start && !gap && (firstPending === null || firstPending > Math.min(now, closes));
  const sealed = now >= closes && (firstPending === null || firstPending > closes);
  const rows = new Map<string, HistoryRow>();
  for (const group of result.results.slice(0, GROUP_LIMIT)) {
    const dimensions = JSON.parse(group.dimensions) as Dimensions;
    dimensions.elapsedCensored = !!dimensions.elapsedCensored; dimensions.activeCensored = !!dimensions.activeCensored;
    const key = group.dimensions + ":" + group.phase;
    const row = rows.get(key) ?? { ...dimensions, phase: group.phase, n: 0, starts: 0, clientCovered: 0, enhancedCovered: 0, duration: emptyHistoryDistribution(dimensions.name), active: emptyHistoryDistribution() };
    row.n += group.n; row.starts += group.starts; row.clientCovered += group.client; row.enhancedCovered += group.enhanced;
    for (const [distribution, n, sum, min, max, index] of [[row.duration, group.value_n, group.value_sum, group.value_min, group.value_max, group.bucket], [row.active, group.active_n, group.active_sum, group.active_min, group.active_max, group.active_bucket]] as const) {
      distribution.n += n; distribution.sum += sum ?? 0; distribution.counts[index] += n;
      if (min !== null) distribution.min = distribution.min === null ? min : Math.min(distribution.min, min);
      if (max !== null) distribution.max = distribution.max === null ? max : Math.max(distribution.max, max);
    }
    rows.set(key, row);
  }
  const payload = JSON.stringify([...rows.values()]);
  const overBudget = result.results.length > GROUP_LIMIT || new TextEncoder().encode(payload).length > DAY_PAYLOAD_BYTES;
  await env.DB.prepare(`INSERT INTO history_days(day,payload,complete,sealed,captured_at,expires) VALUES(?,?,?,?,?,?) ON CONFLICT(day) DO UPDATE SET payload=excluded.payload,complete=excluded.complete,sealed=excluded.sealed,captured_at=excluded.captured_at WHERE history_days.sealed=0 AND history_days.captured_at<=excluded.captured_at`)
    .bind(day, overBudget ? previous?.payload ?? "[]" : payload, complete && !overBudget ? 1 : 0, sealed ? 1 : 0, now, start + (retention + 1) * DAY).run();
}

/** Independent, opt-in maintenance; collection never waits for these writes. */
async function accumulateHistory(env: Env, now: number) {
  const retention = historyRetention(env);
  let state = await env.DB.prepare("SELECT * FROM history_state WHERE id=1").first<State>();
  if (!retention) {
    if (state && state.paused_at === null) await env.DB.prepare("UPDATE history_state SET paused_at=? WHERE id=1 AND paused_at IS NULL").bind(now).run();
  } else {
    if (!state) {
      await env.DB.prepare("INSERT OR IGNORE INTO history_state(id,started_at,cursor_received,cursor_ticket,cursor_id,last_run) VALUES(1,?,?, '', '', ?)").bind(now, now, now).run();
      state = await env.DB.prepare("SELECT * FROM history_state WHERE id=1").first<State>();
    }
    if (!state) throw new Error("Missing history checkpoint");
    if (state.paused_at !== null) {
      await markGaps(env.DB, state.paused_at, now, retention);
      await env.DB.prepare("UPDATE history_state SET paused_at=NULL WHERE id=1").run();
    }
    if (state.last_run < now - 7 * DAY) await markGaps(env.DB, state.last_run, now, retention);
    const expired = await env.DB.prepare(`SELECT received FROM batches WHERE environment='production' AND expires<=? AND ${afterCursor} ORDER BY received,ticket,id LIMIT 1`).bind(now, ...cursorArgs(state)).first<{ received: number }>();
    if (expired) await markGaps(env.DB, Math.min(expired.received, now - CORRECTION_DAYS * DAY), now, retention);
    const batches = await env.DB.prepare(`SELECT ticket,id,received,expires,account,role,release,bytes,events_gzip FROM batches WHERE environment='production' AND expires>? AND received<=? AND ${afterCursor} ORDER BY received,ticket,id LIMIT ?`).bind(now, now, ...cursorArgs(state), BATCH_LIMIT).all<Batch>();
    let bytes = 0;
    const projected: Sample[] = [];
    let checkpoint: Batch | undefined;
    for (const b of batches.results) {
      bytes += b.bytes;
      if (bytes > BYTE_LIMIT) break;
      const raw: unknown = JSON.parse(await decompressEvents(b.events_gzip));
      if (!Array.isArray(raw) || raw.length > LIMITS.batch || raw.some(e => !e || !validEvent(e, e.at))) throw new Error("Invalid history source batch");
      projected.push(...await Promise.all((raw as TelemetryEvent[]).map(e => sample(e, b))));
      checkpoint = b;
    }
    if (checkpoint) {
      const encoded = JSON.stringify(projected);
      const b = checkpoint;
      // Three statements for the whole bounded intake, not per batch. Invalidate both
      // the old and new cohort before moving a late start between days.
      await env.DB.batch([
        env.DB.prepare(`UPDATE history_days SET complete=0 WHERE sealed=0 AND day IN (
          SELECT json_extract(value,'$.day') FROM json_each(?) UNION
          SELECT day FROM history_samples WHERE sample_key IN (SELECT json_extract(value,'$.key') FROM json_each(?)))`).bind(encoded, encoded),
        env.DB.prepare(upsertSamples).bind(encoded, now),
        env.DB.prepare(`UPDATE history_state SET cursor_received=?,cursor_ticket=?,cursor_id=? WHERE id=1 AND (cursor_received<? OR (cursor_received=? AND (cursor_ticket<? OR (cursor_ticket=? AND cursor_id<?))))`).bind(b.received, b.ticket, b.id, b.received, b.received, b.ticket, b.ticket, b.id),
      ]);
      state = { ...state, cursor_received: b.received, cursor_ticket: b.ticket, cursor_id: b.id };
    }
    const backlog = await pending(env.DB, state, now);
    // Expired days must not occupy the bounded refresh slots on every run.
    const candidates: string[] = [];
    for (let at = Math.max(historyDayStart(historyDay(state.started_at)), historyDayStart(historyDay(now)) - Math.min(CORRECTION_DAYS, retention) * DAY); at <= now; at += DAY) candidates.push(historyDay(at));
    // Oldest capture first ensures every mutable day is refreshed without letting
    // a large historical backlog exhaust D1's per-invocation query allowance.
    const days = await env.DB.prepare(`WITH candidates AS (
      SELECT value AS day FROM json_each(?) UNION SELECT day FROM history_days WHERE sealed=0 AND expires>?
    ) SELECT c.day FROM candidates c LEFT JOIN history_days h ON h.day=c.day
      WHERE coalesce(h.sealed,0)=0 ORDER BY CASE WHEN c.day<=? THEN 0 ELSE 1 END,coalesce(h.captured_at,0),c.day LIMIT ?`)
      .bind(JSON.stringify(candidates), now, historyDay(now - CORRECTION_DAYS * DAY), DAY_REFRESH_LIMIT).all<{ day: string }>();
    for (const { day } of days.results) await writeDay(env, day, state, backlog.first_received, now, retention);
    await env.DB.prepare("UPDATE history_state SET last_run=max(last_run,?) WHERE id=1").bind(now).run();
  }
}

export async function maintainHistory(env: Env, now: number) {
  const installed = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='history_state'").first();
  if (!installed && !historyRetention(env)) return;
  if (!installed) throw new Error("History migration required");
  try { await accumulateHistory(env, now); } finally {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM history_samples WHERE expires<=?").bind(now),
    env.DB.prepare("DELETE FROM history_days WHERE expires<=?").bind(now),
    env.DB.prepare("DELETE FROM history_gaps WHERE expires<=?").bind(now),
    env.DB.prepare("UPDATE history_state SET cursor_ticket='',cursor_id='' WHERE cursor_ticket<>'' AND NOT EXISTS (SELECT 1 FROM batches WHERE ticket=history_state.cursor_ticket AND id=history_state.cursor_id AND expires>?)").bind(now),
  ]);
  }
}

/** Filter in D1 before aggregating; never transfer the 90-day dimension product. */
export async function readHistory(env: Env, f: HistoryQuery, now: number, range?: { fromDay: string; toDay: string }): Promise<HistoryData> {
  const retention = historyRetention(env);
  const base: HistoryData = { enabled: retention > 0, retentionDays: retention, generatedAt: now, coverageStart: null, processedThrough: null, pendingBatches: 0, truncated: false, correctionDays: 6, days: [], timingRows: [] };
  if (!retention) return base;
  const state = await env.DB.prepare("SELECT * FROM history_state WHERE id=1").first<State>();
  if (!state) return base;
  base.coverageStart = state.started_at; base.processedThrough = state.cursor_received;
  const from = range?.fromDay ?? historyDay(historyDayStart(historyDay(now)) - (Number(f.days) - 1) * DAY);
  const to = range?.toDay ?? historyDay(now);
  const [backlog, gaps, expiry] = await env.DB.batch([
    pendingStatement(env.DB, state, now),
    env.DB.prepare("SELECT day FROM history_gaps WHERE day>=? AND expires>?").bind(from, now),
    env.DB.prepare("SELECT min(expires) AS expiry FROM (SELECT expires FROM history_samples WHERE day>=? AND day<=? AND expires>? UNION ALL SELECT expires FROM history_days WHERE day>=? AND day<=? AND expires>? UNION ALL SELECT expires FROM batches WHERE environment='production' AND expires>?)").bind(from, to, now, from, to, now, now),
  ]) as [{ results: { n: number }[] }, { results: { day: string }[] }, { results: { expiry: number | null }[] }];
  base.pendingBatches = backlog.results[0]?.n ?? 0;
  const tail = await readHistoryTail(env.DB, state, from, to, now, f);
  const gapDays = new Set(gaps.results.map(d => d.day));
  const mutable = JSON.parse(tail.payload) as { day: string; payload: string }[];
  const payloads = new Map(mutable.map(d => [d.day, d.payload]));
  const live = [];
  for (let start = Math.max(historyDayStart(from), historyDayStart(historyDay(state.started_at))); start <= Math.min(now, historyDayStart(to) + DAY - 1); start += DAY) {
    const day = historyDay(start);
    live.push({ day, payload: payloads.get(day) ?? "[]", complete: state.started_at <= start && now < start + 7 * DAY && !gapDays.has(day) && !tail.truncated && state.paused_at === null ? 1 : 0 });
  }
  base.validUntil = Math.min(now + 60000, expiry.results[0]?.expiry ?? now + 60000);
  base.coverage = { from: historyDayStart(from), to: now, tailBatches: tail.batches, tailBytes: tail.bytes,
    tailTruncated: tail.truncated, summaryComplete: false, timingRowsTruncated: false,
    unavailable: ["distinctSessions", "distinctAccounts", "browser", "source", "visibility", "clientVersion"], timeZone: "Asia/Shanghai" };
  const filters: string[] = [];
  const args: (string | number)[] = [from, to, now, JSON.stringify(live)];
  for (const key of ["scene", "role", "route", "device", "release", "eventId", "task"] as const) {
    if (f[key]) { filters.push(`json_extract(e.value,'$.${key}')=?`); args.push(f[key]); }
  }
  if (f.operation) { filters.push("json_extract(e.value,'$.kind')='operation' AND json_extract(e.value,'$.name')=?"); args.push(f.operation); }
  const selected = `WITH stored AS (SELECT day,payload,complete,sealed FROM history_days WHERE day>=? AND day<=? AND expires>?),
    selected AS (SELECT * FROM stored WHERE sealed=1 UNION ALL
      SELECT json_extract(value,'$.day'),json_extract(value,'$.payload'),json_extract(value,'$.complete'),0 FROM json_each(?) WHERE json_extract(value,'$.day') NOT IN (SELECT day FROM stored WHERE sealed=1)),
    filtered AS (SELECT d.day,e.value FROM selected d,json_each(d.payload) e ${filters.length ? "WHERE " + filters.join(" AND ") : ""})`;
  const get = (key: string) => key === "basis" ? `coalesce(json_extract(f.value,'$.basis'),CASE WHEN json_extract(f.value,'$.kind')='ready' THEN 'navigation' ELSE '' END)` : ["elapsedCensored", "activeCensored"].includes(key) ? `coalesce(json_extract(f.value,'$.${key}'),0)` : `json_extract(f.value,'$.${key}')`;
  const conditionCount = (condition: string, field = "n") => `coalesce(sum(CASE WHEN ${condition} THEN ${get(field)} ELSE 0 END),0)`;
  const kind = get("kind"), phase = get("phase");
  const pointsQuery = env.DB.prepare(`${selected}
    SELECT d.day,d.complete,d.sealed,
      ${conditionCount(`${kind}='page'`)} views,
      ${conditionCount(`${kind}='error'`)} errors,
      ${conditionCount(`${kind}='operation'`, "starts")} operations,
      ${conditionCount(`${kind}='operation' AND ${phase}='success'`, "starts")} success,
      ${conditionCount(`${kind}='operation' AND ${phase}='rejected'`, "starts")} rejected,
      ${conditionCount(`${kind}='operation' AND ${phase}='unknown'`, "starts")} unknown,
      ${conditionCount(`${kind}='operation' AND ${phase} NOT IN ('success','rejected','unknown')`, "starts")} pending,
      ${conditionCount(`${kind}='task'`, "starts")} taskStarts,
      ${conditionCount(`${kind}='task' AND ${phase}='complete'`, "starts")} taskComplete,
      ${conditionCount(`${kind}='task' AND ${phase}='exposure'`)} taskExposure
    FROM selected d LEFT JOIN filtered f ON f.day=d.day GROUP BY d.day ORDER BY d.day`).bind(...args);
  const dimensions = ["kind", "name", "phase", "release", "measurementVersion", "definitionVersion", "navigationType", "basis", "elapsedCensored", "activeCensored"] as const;
  const aggregates: string[] = [];
  for (const metric of ["duration", "active"] as const) {
    for (const [field, op] of [["n", "sum"], ["sum", "sum"], ["min", "min"], ["max", "max"]] as const) aggregates.push(`${op}(${get(`${metric}.${field}`)}) ${metric}_${field}`);
    for (let i = 0; i <= historyBounds("").length; i++) aggregates.push(`coalesce(sum(${get(`${metric}.counts[${i}]`)}),0) ${metric}_${i}`);
  }
  const groupsQuery = env.DB.prepare(`${selected}
    SELECT ${dimensions.map(key => `${get(key)} AS ${key}`).join(",")},sum(${get("n")}) reports,${aggregates.join(",")}
    FROM filtered f WHERE ${get("duration.n")}>0 OR ${get("active.n")}>0 OR ${get("elapsedCensored")}=1 OR ${get("activeCensored")}=1
    GROUP BY ${dimensions.map(get).join(",")} ORDER BY ${dimensions.map(get).join(",")} LIMIT ?`)
    .bind(...args, TIMING_LIMIT + 1);
  const [points, groups] = await env.DB.batch([pointsQuery, groupsQuery]) as [
    { results: (Omit<HistoryData["days"][number], "complete" | "sealed"> & { complete: number; sealed: number })[] },
    { results: Record<string, string | number | null>[] },
  ];
  base.days = points.results.map(d => ({ ...d, complete: !!d.complete, sealed: !!d.sealed }));
  base.truncated = groups.results.length > TIMING_LIMIT || tail.truncated;
  base.coverage.summaryComplete = base.days.length === Math.round((historyDayStart(to) - historyDayStart(from)) / DAY) + 1 && base.days.every(d => d.complete);
  base.coverage.timingRowsTruncated = groups.results.length > TIMING_LIMIT;
  base.timingRows = groups.results.slice(0, TIMING_LIMIT).map(group => {
    const row = Object.fromEntries(dimensions.map(key => [key, group[key]])) as Omit<HistoryTimingRow, "duration" | "active" | "elapsedCensored" | "activeCensored">;
    const distribution = (metric: "duration" | "active") => ({
      n: Number(group[metric + "_n"]), sum: Number(group[metric + "_sum"]),
      min: group[metric + "_min"] as number | null, max: group[metric + "_max"] as number | null,
      counts: Array.from({ length: historyBounds(metric === "duration" ? row.name : "").length + 1 }, (_, i) => Number(group[metric + "_" + i])),
    });
    return { ...row, reports: Number(group.reports), elapsedCensored: !!group.elapsedCensored, activeCensored: !!group.activeCensored, duration: distribution("duration"), active: distribution("active") };
  });
  return base;
}

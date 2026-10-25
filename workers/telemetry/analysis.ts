import {
  analyzeTelemetry,
  type EventRow,
  type AnalysisSnapshot,
} from "../../src/lib/telemetry/analysis-model";
import {
  ANALYSIS_BATCH_LIMIT,
  ANALYSIS_BYTES_LIMIT,
  type AnalysisFilters,
  analysisWindow,
} from "../../src/lib/telemetry/analysis-query";
import {
  LIMITS,
  validEvent,
  type TelemetryEvent,
} from "../../src/lib/telemetry/protocol";
import { sample } from "./history";
import { decompressEvents } from "./storage";
import type { Database } from "./index";
interface Batch {
  ticket: string;
  id: string;
  received: number;
  expires: number;
  bytes: number;
  account: string | null;
  session: string;
  role: string;
  release: string;
  summary: string;
  events_gzip: number[] | Uint8Array;
}
async function sessionAlias(session: string) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`rivalhub-dashboard-session-v1:${session}`),
  );
  return Array.from(new Uint8Array(hash))
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
/** Read-only bounded analysis. Raw batches and identity keys never leave the receiver. */
export async function readAnalysisSnapshot(
  db: Database,
  filters: AnalysisFilters,
  now: number,
  budget: { batches: number; bytes: number },
  byteLimit = ANALYSIS_BYTES_LIMIT,
  batchLimit = ANALYSIS_BATCH_LIMIT,
  followups = true,
  historyKeys = false,
): Promise<AnalysisSnapshot> {
  const window = analysisWindow(filters, now);
  const from = window.from;
  // Follow-up reports settle starts in a fixed window; presentation remains scoped to that window.
  const readTo = followups ? Math.min(now, window.to + 86400000 + LIMITS.ageMs) : window.to;
  const ticketRelease = filters.releaseBasis === "ticket" ? filters.release : "";
  const base = `SELECT ticket,id,received,expires,bytes FROM batches WHERE environment='production' AND expires>? AND received>=? AND received<=? AND (?='' OR release=?) ORDER BY received DESC,ticket DESC,id DESC LIMIT ?`;
  const args = [
    now,
    from,
    readTo,
    ticketRelease,
    ticketRelease,
    batchLimit + 1,
  ];
  const results = (await db.batch([
    db
      .prepare(`SELECT count(*) AS n,sum(bytes) AS bytes FROM (${base})`)
      .bind(...args),
    db
      .prepare(
        `WITH selected AS (SELECT *,sum(bytes) OVER (ORDER BY received DESC,ticket DESC,id DESC) AS accumulated,row_number() OVER (ORDER BY received DESC,ticket DESC,id DESC) AS rn FROM (${base})) SELECT b.ticket,b.id,b.received,b.expires,b.bytes,b.account,b.session,b.role,b.release,b.summary,b.events_gzip FROM selected s JOIN batches b ON b.ticket=s.ticket AND b.id=s.id WHERE s.rn<=? AND s.accumulated<=? ORDER BY b.received,b.ticket,b.id`,
      )
      .bind(...args, batchLimit, byteLimit),
    db.prepare("SELECT day,batches,bytes FROM usage ORDER BY day DESC LIMIT 8"),
    db
      .prepare(
        "SELECT count(*) AS expiredBatches FROM batches WHERE expires<=?",
      )
      .bind(now),
    db.prepare("SELECT release FROM batches WHERE environment='production' AND expires>? AND received>=? AND received<=? ORDER BY received DESC,ticket DESC,id DESC LIMIT ?")
      .bind(now, from, window.to, batchLimit + 1),
  ])) as Array<{ results: unknown[] }>;
  const meta = results[0].results[0] as { n: number; bytes: number | null };
  const batches = results[1].results as Batch[];
  const events: EventRow[] = [];
  const metricIds = new Set<string>();
  const aliases = new Map<string, string>();
  let decodedBytes = 0;
  for (const b of batches) {
    const body = await decompressEvents(b.events_gzip);
    decodedBytes += new TextEncoder().encode(body).byteLength;
    if (decodedBytes > byteLimit)
      throw new Error("Telemetry analysis exceeds byte budget");
    const raw: unknown = JSON.parse(body);
    if (
      !Array.isArray(raw) ||
      raw.length > LIMITS.batch ||
      raw.some((e) => !e || typeof e.at !== "number" || !validEvent(e, e.at))
    )
      throw new Error("Invalid telemetry analysis batch");
    const summary: unknown = JSON.parse(b.summary);
    if (!Array.isArray(summary)) throw new Error("Invalid telemetry summary");
    for (const row of summary)
      if (
        Array.isArray(row) &&
        row[2] === "performance" &&
        typeof row[11] === "string"
      )
        metricIds.add(row[11]);
    let alias = aliases.get(b.session);
    if (!alias) {
      alias = await sessionAlias(b.session);
      aliases.set(b.session, alias);
    }
    for (const e of raw as TelemetryEvent[])
      events.push({
        ...e,
        ...(historyKeys ? { historyKey: (await sample(e, b)).key } : {}),
        session: alias,
        account: b.account,
        role: b.role,
        release: b.release,
        received: b.received,
        expires: b.expires,
        eventId: e.eventId ?? null,
      });
  }
  const validUntil = Math.min(now + 60000, ...batches.map((b) => b.expires));
  return {
      capturedAt: now,
      batches: batches.length,
      bytes: batches.reduce((n, b) => n + b.bytes, 0),
      oldest: batches.length ? batches[0].received : now,
      events,
      metricIds: [...metricIds],
      usage: {
        budget,
        usage: results[2].results as {
          day: string;
          batches: number;
          bytes: number;
        }[],
        expiredBatches: (results[3].results[0] as { expiredBatches: number })
          .expiredBatches,
      },
      truncated: meta.n > batches.length,
      validUntil,
      ticketReleases: (results[4].results as { release: string }[]).slice(0, batchLimit).map(r => r.release),
      releaseDirectoryTruncated: results[4].results.length > batchLimit || meta.n > batches.length,
    };
}

export async function analysis(db: Database, filters: AnalysisFilters, session: string, now: number, budget: { batches: number; bytes: number }) {
  return analyzeTelemetry(await readAnalysisSnapshot(db, filters, now, budget), filters, session);
}

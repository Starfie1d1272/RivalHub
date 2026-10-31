import "server-only";

import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import { TOURNAMENT_PERFORMANCE_PROJECTION_VERSION, type TournamentPerformanceMapProjection, type TournamentMapFacts } from "@cs2dak/tournament";
import { sql } from "drizzle-orm";
import { matchDemoStatProjections, type StatisticsPerformanceTransport, type StatisticsTournamentTransport } from "@/db/schema";

const compress = promisify(gzip);
const decompress = promisify(gunzip);
const MAX_JSON = 1024 * 1024;
const MAX_GZIP = 256 * 1024;
const MAX_BASE64 = Math.ceil(MAX_GZIP / 3) * 4;
const MAX_ACTIVE = 2;
const MAX_WAITERS = 16;
let active = 0;
const waiters: Array<() => void> = [];

export class ProjectionTransportUnavailableError extends Error {
  constructor() { super("Statistics projection codec unavailable"); this.name = "ProjectionTransportUnavailableError"; }
}
export class ProjectionTransportIntegrityError extends Error {
  constructor() { super("Statistics projection transport integrity failed"); this.name = "ProjectionTransportIntegrityError"; }
}

async function acquire(wait: boolean): Promise<(() => void) | null> {
  if (active >= MAX_ACTIVE) {
    if (!wait) return null;
    if (waiters.length >= MAX_WAITERS) throw new ProjectionTransportUnavailableError();
    await new Promise<void>((resolve, reject) => {
      const wake = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        const index = waiters.indexOf(wake);
        if (index >= 0) waiters.splice(index, 1);
        reject(new ProjectionTransportUnavailableError());
      }, 2000);
      waiters.push(wake);
    });
    // The releasing owner transfers its slot directly to this waiter.
  } else active++;
  return () => {
    const next = waiters.shift();
    if (next) next(); else active--;
  };
}

function digest(bytes: Buffer) { return createHash("sha256").update(bytes).digest("hex"); }

/** Failure or saturation never prevents the legacy projection from being written. */
async function encodeTransport(value: unknown, tournament: boolean): Promise<StatisticsPerformanceTransport | StatisticsTournamentTransport | null> {
  const release = await acquire(false);
  if (!release) return null;
  try {
    const raw = Buffer.from(JSON.stringify(value), "utf8");
    if (raw.length > MAX_JSON) return null;
    const zipped = await compress(raw, { level: 6 });
    if (zipped.length > MAX_GZIP) return null;
    const result: StatisticsPerformanceTransport | StatisticsTournamentTransport = { version: 1, ...(tournament ? { kind: "tournament" as const } : {}), codec: "gzip-base64", uncompressedBytes: raw.length, sha256: digest(raw), payload: zipped.toString("base64") };
    return Buffer.byteLength(JSON.stringify(result)) < raw.length ? result : null;
  } catch {
    return null;
  } finally { release(); }
}

export async function encodePerformanceTransport(value: TournamentPerformanceMapProjection): Promise<StatisticsPerformanceTransport | null> {
  return encodeTransport(value, false);
}

export async function encodeTournamentTransport(value: TournamentMapFacts): Promise<StatisticsTournamentTransport | null> {
  return await encodeTransport(value, true) as StatisticsTournamentTransport | null;
}

async function decodeTransport(value: unknown, tournament: boolean): Promise<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProjectionTransportIntegrityError();
  const transport = value as Record<string, unknown>;
  if ((tournament && transport.kind !== "tournament") || transport.version !== 1 || transport.codec !== "gzip-base64" || !Number.isSafeInteger(transport.uncompressedBytes)
    || (transport.uncompressedBytes as number) < 1 || (transport.uncompressedBytes as number) > MAX_JSON
    || typeof transport.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(transport.sha256)
    || typeof transport.payload !== "string" || transport.payload.length > MAX_BASE64
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(transport.payload)) throw new ProjectionTransportIntegrityError();
  const zipped = Buffer.from(transport.payload, "base64");
  if (!zipped.length || zipped.length > MAX_GZIP || zipped.toString("base64") !== transport.payload) throw new ProjectionTransportIntegrityError();
  const release = await acquire(true);
  if (!release) throw new ProjectionTransportUnavailableError();
  try {
    const raw = await decompress(zipped, { maxOutputLength: transport.uncompressedBytes as number });
    if (raw.length !== transport.uncompressedBytes || digest(raw) !== transport.sha256) throw new ProjectionTransportIntegrityError();
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ProjectionTransportIntegrityError();
    const row = parsed as Record<string, unknown>;
    if (![row.mapKey, row.matchKey, row.mapName, row.semanticProfile, row.analysisVersion].every(v => typeof v === "string" && v.length > 0) ||
      (!tournament && (row.version !== TOURNAMENT_PERFORMANCE_PROJECTION_VERSION || !Object.hasOwn(row, "data")))) throw new ProjectionTransportIntegrityError();
    return row;
  } catch (error) {
    if (error instanceof ProjectionTransportIntegrityError) throw error;
    throw new ProjectionTransportIntegrityError();
  } finally { release(); }
}

/** Select exactly one representation; a present corrupt sidecar must fail closed. */
export const performanceTransportSelection = sql`CASE WHEN ${matchDemoStatProjections.facts} ? 'performanceTransport'
  THEN jsonb_build_object('performanceTransport', ${matchDemoStatProjections.facts}->'performanceTransport')
  ELSE jsonb_build_object('performance', ${matchDemoStatProjections.facts}->'performance') END`;

export async function decodePerformanceTransport(value: unknown): Promise<TournamentPerformanceMapProjection> {
  return await decodeTransport(value, false) as unknown as TournamentPerformanceMapProjection;
}

export async function decodeTournamentTransport(value: unknown): Promise<TournamentMapFacts> {
  return await decodeTransport(value, true) as unknown as TournamentMapFacts;
}

export const tournamentTransportSelection = sql`CASE WHEN ${matchDemoStatProjections.facts} ? 'tournamentTransport'
  THEN jsonb_build_object('tournamentTransport', ${matchDemoStatProjections.facts}->'tournamentTransport')
  ELSE jsonb_build_object('tournament', ${matchDemoStatProjections.facts}->'tournament') END`;

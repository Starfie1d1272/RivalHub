import "server-only";
import { Agent, get } from "node:https";
import { z } from "zod";
import type { ClientRequest, IncomingMessage } from "node:http";
import { DB_SOURCES } from "@/lib/observability/db-traffic-contract";
import { beginRuntimeResource } from "@/lib/observability/runtime-resources";
import { recordDashboardFailure, type DashboardEndpoint, type DashboardReason, type DashboardStage } from "@/lib/observability/read-budget";
import { requireSuperAdmin } from "@/lib/auth/session";
import { AnalysisData } from "./analysis-contract";
import { parseAnalysisQuery } from "./analysis-query";
import type { Analysis } from "./analysis-model";
const RESPONSE_BYTES = 1024 * 1024;
const CACHE_BYTES = 2 * RESPONSE_BYTES;
const INFLIGHT_BYTES = 4 * RESPONSE_BYTES;
const cache = new Map<string, { expires: number; body: Buffer; bytes: number }>();
let residentBytes = 0;
let inflightBytes = 0;
function evict(key: string) {
  const entry = cache.get(key);
  if (entry) { residentBytes -= entry.bytes; cache.delete(key); }
}
function pruneCache(now: number) {
  for (const [key, entry] of cache) if (entry.expires <= now) evict(key);
}
const pending = new Map<string, Promise<QueryResult<unknown>>>();

class DashboardFailure extends Error {
  constructor(readonly reason: DashboardReason, readonly stage: DashboardStage, readonly httpStatus?: number) { super("Dashboard read failed"); }
}

async function queryThroughProxy(
  endpoint: URL,
  secret: string,
  proxy: URL,
  signal: AbortSignal,
): Promise<Buffer> {
  const agent = new Agent({
    proxyEnv: { NODE_ENV: process.env.NODE_ENV, HTTPS_PROXY: proxy.href },
  });
  let request: ClientRequest | undefined;
  let incoming: IncomingMessage | undefined;
  let responseStarted = false;
  let bodyFailure: DashboardFailure | undefined;
  const abort = () => {
    const error = new Error("Telemetry query deadline exceeded");
    incoming?.destroy(error);
    request?.destroy(error);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      request = get(
        endpoint,
        {
          agent,
          headers: { Authorization: `Bearer ${secret}` },
          signal,
        },
        (response) => {
          incoming = response;
          responseStarted = true;
          if (response.statusCode !== 200) {
            response.destroy();
            reject(new DashboardFailure("http_status", "transport", response.statusCode));
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.byteLength;
            if (bytes > RESPONSE_BYTES) {
              bodyFailure = new DashboardFailure("body_limit", "body");
              response.destroy(bodyFailure);
            }
            else chunks.push(chunk);
          });
          response.on("end", () => resolve(Buffer.concat(chunks)));
          response.on("error", error => reject(bodyFailure ?? (error instanceof DashboardFailure ? error : new DashboardFailure("network", "body"))));
        },
      );
      request.on("error", () => reject(bodyFailure ?? new DashboardFailure("network", responseStarted ? "body" : "transport")));
      if (signal.aborted) abort();
    });
  } finally {
    signal.removeEventListener("abort", abort);
    agent.destroy();
  }
}

async function queryDirect(endpoint: URL, secret: string, signal: AbortSignal): Promise<Buffer> {
  let response: Response;
  try { response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${secret}` }, cache: "no-store", redirect: "error", signal,
  }); } catch { throw new DashboardFailure("network", "transport"); }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new DashboardFailure("http_status", "transport", response.status);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new DashboardFailure("body_missing", "body");
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > RESPONSE_BYTES) throw new DashboardFailure("body_limit", "body");
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    if (error instanceof DashboardFailure) throw error;
    throw new DashboardFailure("network", "body");
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}

type QueryResult<T> =
  | { status: "ready"; data: T }
  | { status: "unconfigured" | "unavailable" };
async function readDashboard<T>(
  kind: DashboardEndpoint,
  path: string,
  params: Record<string, string>,
  parse: (input: unknown) => T,
  validUntil: (data: T) => number,
): Promise<QueryResult<T>> {
  const key = path + JSON.stringify(params);
  pruneCache(Date.now());
  const hit = cache.get(key);
  if (hit) {
    // Cache holds encoded bytes only; parsed graphs belong to the current caller.
    let value: unknown;
    try { value = JSON.parse(hit.body.toString("utf8")); }
    catch { recordDashboardFailure(kind, "json", "cache"); evict(key); }
    if (value !== undefined) {
      try { return { status: "ready", data: parse(value) }; }
      catch { recordDashboardFailure(kind, "schema", "cache"); evict(key); }
    }
  }
  const active = pending.get(key);
  if (active) return active as Promise<QueryResult<T>>;
  if (pending.size >= 12 || inflightBytes + RESPONSE_BYTES > INFLIGHT_BYTES) { recordDashboardFailure(kind, "capacity", "admission"); return { status: "unavailable" }; }
  inflightBytes += RESPONSE_BYTES;
  const loading = loadDashboard(kind, key, path, params, parse, validUntil);
  pending.set(key, loading);
  try {
    return await loading;
  } finally {
    if (pending.get(key) === loading) pending.delete(key);
    inflightBytes -= RESPONSE_BYTES;
  }
}

async function loadDashboard<T>(
  kind: DashboardEndpoint,
  key: string,
  path: string,
  params: Record<string, string>,
  parse: (input: unknown) => T,
  validUntil: (data: T) => number,
): Promise<QueryResult<T>> {
  const started = performance.now();
  const record = (reason: DashboardReason, stage: DashboardStage, httpStatus?: number) =>
    recordDashboardFailure(kind, reason, stage, { httpStatus, durationMs: performance.now() - started });
  const secret = process.env.PRODUCT_TELEMETRY_ADMIN_KEY;
  if (!secret || secret.length < 32 || !process.env.PRODUCT_TELEMETRY_ENDPOINT) {
    record("configuration", "config");
    return { status: "unconfigured" };
  }
  let finish: (() => void) | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let phase: DashboardStage = "config";
  try {
    const endpoint = new URL(process.env.PRODUCT_TELEMETRY_ENDPOINT);
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== "/v1/batches"
    ) {
      record("configuration", "config");
      return { status: "unconfigured" };
    }
    endpoint.pathname = path;
    endpoint.search = new URLSearchParams(params).toString();
    const proxyValue = process.env.PRODUCT_TELEMETRY_QUERY_PROXY_URL;
    const proxy = proxyValue ? new URL(proxyValue) : undefined;
    if (proxy && (!["http:", "https:"].includes(proxy.protocol) || proxy.username || proxy.password
      || proxy.pathname !== "/" || proxy.search || proxy.hash)) { record("configuration", "config"); return { status: "unconfigured" }; }
    // One total transport/body deadline; long-window does not change short query policy.
    const controller = new AbortController();
    deadline = setTimeout(() => { timedOut = true; controller.abort(); }, path === "/admin/long-window" ? 15_000 : 5_000);
    phase = "transport";
    finish = beginRuntimeResource("telemetry.dashboard.fill");
    const body = proxy
      ? await queryThroughProxy(endpoint, secret, proxy, controller.signal)
      : await queryDirect(endpoint, secret, controller.signal);
    phase = "json";
    const decoded: unknown = JSON.parse(body.toString("utf8"));
    phase = "schema";
    const data = parse(decoded);
    phase = "cache";
    const encoded = Buffer.from(JSON.stringify(data), "utf8");
    pruneCache(Date.now());
    evict(key);
    if (encoded.byteLength <= RESPONSE_BYTES) {
      const bytes = encoded.byteLength + Buffer.byteLength(key, "utf8");
      while (cache.size >= 12 || residentBytes + bytes > CACHE_BYTES) evict(cache.keys().next().value!);
      cache.set(key, { expires: Math.min(Date.now() + 60000, validUntil(data)), body: encoded, bytes });
      residentBytes += bytes;
    }
    return { status: "ready", data };
  } catch (error) {
    if (timedOut) record("timeout", error instanceof DashboardFailure ? error.stage : phase);
    else if (error instanceof DashboardFailure) record(error.reason, error.stage, error.httpStatus);
    else record(phase === "config" ? "configuration" : phase === "json" ? "json" : phase === "schema" ? "schema" : "internal", phase);
    return { status: "unavailable" };
  } finally { clearTimeout(deadline); finish?.(); }
}

export async function getTelemetryAnalysis(
  input: unknown,
): Promise<QueryResult<Analysis>> {
  await requireSuperAdmin();
  const query = parseAnalysisQuery(input);
  if (!query) throw new Error("Invalid telemetry analysis filters");
  return readDashboard(
    "analysis",
    "/admin/analysis",
    { ...query.filters, session: query.session },
    (input) => AnalysisData.parse(input),
    (data) => data.meta.validUntil,
  );
}

export async function getTelemetryHistory(input: unknown) {
  await requireSuperAdmin();
  const { HistoryData, parseHistoryQuery } = await import("./history-contract");
  const query = parseHistoryQuery(input);
  if (!query) throw new Error("Invalid telemetry history filters");
  return readDashboard("history", "/admin/history", query, value => HistoryData.parse(value), data => data.validUntil ?? data.generatedAt + 60000);
}


export async function getLongWindowSummary(input: unknown) {
  await requireSuperAdmin();
  const { LongWindowSummary } = await import("./long-window-contract");
  const query = parseAnalysisQuery(input);
  if (!query) throw new Error("Invalid telemetry long-window filters");
  return readDashboard("long_window", "/admin/long-window", { ...query.filters, session: query.session }, value => LongWindowSummary.parse(value), data => data.validUntil);
}

const DbTrafficSkipReasons = z.object({ budget: z.number(), unsupported_value: z.number(), error: z.number() });
const DbTrafficScopedMetric = z.object({ source: z.string(), queries: z.number(), failures: z.number(), rows: z.number(), queryMs: z.number(), logicalRowJsonBytes: z.number(), logicalMeasuredQueries: z.number(), rxBytes: z.number(), skipReasons: DbTrafficSkipReasons, rxComplete: z.boolean(), logicalComplete: z.boolean(), skipReasonsComplete: z.boolean() });
const DbTrafficWindow = z.object({ hour: z.number(), release: z.string(), deployment: z.string(), batches: z.number(), processes: z.number(), queries: z.number(), rows: z.number(), receivedBytes: z.number(), dropped: z.number(), droppedReceivedBytes: z.number().optional(), unconfirmedReceivedBytes: z.number().optional(), unconfirmedBatches: z.number().optional(), lossComplete: z.boolean().optional(), connections: z.number(), observedConnections: z.number(), remainingRxBytes: z.number(), remaining: z.object({ async: z.number(), no_owner: z.number(), partial: z.number(), unsupported: z.number(), instrumentation: z.number() }), rxComplete: z.boolean(), logicalComplete: z.boolean(), skipReasonsComplete: z.boolean(), scopedComplete: z.boolean(), truncated: z.boolean(), sources: z.array(DbTrafficScopedMetric.extend({ unsupported: z.number(), overflow: z.number() })).max(DB_SOURCES.length), shapes: z.array(DbTrafficScopedMetric.extend({ template: z.string() })).max(120) });
const DbTrafficData = z.object({ quality: z.array(z.object({ hour: z.number(), release: z.string(), deployment: z.string(), batches: z.number(), reasons: z.record(z.string(), z.number()), lostBatches: z.number().optional(), unconfirmedBatches: z.number().optional(), lostBytes: z.number().optional(), unconfirmedBytes: z.number().optional(), coverageUnknownSince: z.number().nullable().optional(), truncated: z.boolean() })).max(1000).optional(), qualityDetails: z.array(z.object({ at: z.number(), batch: z.unknown(), reasons: z.array(z.string()) })).max(10).optional(), qualityDetailsTruncated: z.boolean().optional(), qualityPending: z.number().optional(), qualityTruncated: z.boolean().optional(), windows: z.array(DbTrafficWindow).max(1000).optional(), unscopedHours: z.array(z.number()).max(72).optional(), offline: z.array(z.object({ consumer: z.string(), run: z.string(), release: z.string(), started: z.number(), ended: z.number(), status: z.string(), rows: z.number().nullable(), logicalBytes: z.number().nullable(), dumpBytes: z.number().nullable(), snapshotBytes: z.number().nullable(), artifactBytes: z.number().nullable(), storageBytes: z.number().nullable() })).max(100), offlineTruncated: z.boolean(), generatedAt: z.number(), start: z.number(), pending: z.number(), dropped: z.number(), droppedReceivedBytes: z.number().optional(), unconfirmedReceivedBytes: z.number().optional(), unconfirmedBatches: z.number().optional(), lossComplete: z.boolean().optional(), receivedBytes: z.number(), connections: z.number(), observedConnections: z.number(), truncated: z.boolean(), sources: z.array(z.object({ source: z.string(), queries: z.number(), failures: z.number(), rows: z.number(), queryMs: z.number(), logicalRowJsonBytes: z.number(), logicalMeasuredQueries: z.number(), unsupported: z.number(), overflow: z.number() })).max(DB_SOURCES.length), totals: z.array(z.object({ source: z.string(), template: z.string(), queries: z.number(), failures: z.number(), rows: z.number(), queryMs: z.number(), logicalRowJsonBytes: z.number(), logicalMeasuredQueries: z.number() })).max(20), byTime: z.array(z.object({ source: z.string(), template: z.string(), queries: z.number(), failures: z.number(), rows: z.number(), queryMs: z.number(), logicalRowJsonBytes: z.number(), logicalMeasuredQueries: z.number() })).max(20), byBytes: z.array(z.object({ source: z.string(), template: z.string(), queries: z.number(), failures: z.number(), rows: z.number(), queryMs: z.number(), logicalRowJsonBytes: z.number(), logicalMeasuredQueries: z.number() })).max(20), byRows: z.array(z.object({ source: z.string(), template: z.string(), queries: z.number(), failures: z.number(), rows: z.number(), queryMs: z.number(), logicalRowJsonBytes: z.number(), logicalMeasuredQueries: z.number() })).max(20), hours: z.array(z.object({ hour: z.number(), release: z.string(), deployment: z.string(), batches: z.number(), processes: z.number(), receivedBytes: z.number(), queries: z.number(), rows: z.number(), logicalRowJsonBytes: z.number(), logicalMeasuredQueries: z.number() })).max(1000) });
export async function getDbTraffic(hours: 24 | 72, selection?: { hour?: string; release?: string; deployment?: string }) {
  await requireSuperAdmin();
  const params: Record<string, string> = { hours: String(hours) };
  if (selection?.hour && /^\d{1,16}$/.test(selection.hour) && Number.isSafeInteger(Number(selection.hour)) && Number(selection.hour) % 3600000 === 0 && selection.release && /^[A-Za-z0-9._-]{1,80}$/.test(selection.release) && selection.deployment && /^[A-Za-z0-9._-]{1,80}$/.test(selection.deployment)) {
    params.hour = selection.hour; params.release = selection.release; params.deployment = selection.deployment;
  }
  return readDashboard("database", "/admin/db-traffic", params, value => DbTrafficData.parse(value), data => data.generatedAt + 60000);
}

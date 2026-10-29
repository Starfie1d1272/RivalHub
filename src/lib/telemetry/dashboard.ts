import "server-only";
import { Agent, get } from "node:https";
import { z } from "zod";
import type { ClientRequest, IncomingMessage } from "node:http";
import { DB_SOURCES } from "@/lib/observability/db-traffic-contract";
import { beginRuntimeResource } from "@/lib/observability/runtime-resources";
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
          if (response.statusCode !== 200) {
            response.destroy();
            reject(new Error("Telemetry query unavailable"));
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.byteLength;
            if (bytes > RESPONSE_BYTES)
              response.destroy(new Error("Telemetry response too large"));
            else chunks.push(chunk);
          });
          response.on("end", () => resolve(Buffer.concat(chunks)));
          response.on("error", reject);
        },
      );
      request.on("error", reject);
      if (signal.aborted) abort();
    });
  } finally {
    signal.removeEventListener("abort", abort);
    agent.destroy();
  }
}

async function queryDirect(endpoint: URL, secret: string, signal: AbortSignal): Promise<Buffer> {
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${secret}` }, cache: "no-store", redirect: "error", signal,
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Telemetry query unavailable");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Telemetry response unavailable");
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
      if (bytes > RESPONSE_BYTES) throw new Error("Telemetry response too large");
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks);
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
    return { status: "ready", data: parse(JSON.parse(hit.body.toString("utf8"))) };
  }
  const active = pending.get(key);
  if (active) return active as Promise<QueryResult<T>>;
  if (pending.size >= 12 || inflightBytes + RESPONSE_BYTES > INFLIGHT_BYTES) return { status: "unavailable" };
  inflightBytes += RESPONSE_BYTES;
  const loading = loadDashboard(key, path, params, parse, validUntil);
  pending.set(key, loading);
  try {
    return await loading;
  } finally {
    if (pending.get(key) === loading) pending.delete(key);
    inflightBytes -= RESPONSE_BYTES;
  }
}

async function loadDashboard<T>(
  key: string,
  path: string,
  params: Record<string, string>,
  parse: (input: unknown) => T,
  validUntil: (data: T) => number,
): Promise<QueryResult<T>> {
  const secret = process.env.PRODUCT_TELEMETRY_ADMIN_KEY;
  if (!secret || secret.length < 32 || !process.env.PRODUCT_TELEMETRY_ENDPOINT)
    return { status: "unconfigured" };
  let finish: (() => void) | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const endpoint = new URL(process.env.PRODUCT_TELEMETRY_ENDPOINT);
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== "/v1/batches"
    )
      return { status: "unconfigured" };
    endpoint.pathname = path;
    endpoint.search = new URLSearchParams(params).toString();
    const proxyValue = process.env.PRODUCT_TELEMETRY_QUERY_PROXY_URL;
    const proxy = proxyValue ? new URL(proxyValue) : undefined;
    if (proxy && (!["http:", "https:"].includes(proxy.protocol) || proxy.username || proxy.password
      || proxy.pathname !== "/" || proxy.search || proxy.hash)) return { status: "unconfigured" };
    // One total transport/body deadline; long-window does not change short query policy.
    const controller = new AbortController();
    deadline = setTimeout(() => controller.abort(), path === "/admin/long-window" ? 15_000 : 5_000);
    finish = beginRuntimeResource("telemetry.dashboard.fill");
    const body = proxy
      ? await queryThroughProxy(endpoint, secret, proxy, controller.signal)
      : await queryDirect(endpoint, secret, controller.signal);
    const data = parse(JSON.parse(body.toString("utf8")));
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
  } catch {
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
  return readDashboard("/admin/history", query, value => HistoryData.parse(value), data => data.validUntil ?? data.generatedAt + 60000);
}


export async function getLongWindowSummary(input: unknown) {
  await requireSuperAdmin();
  const { LongWindowSummary } = await import("./long-window-contract");
  const query = parseAnalysisQuery(input);
  if (!query) throw new Error("Invalid telemetry long-window filters");
  return readDashboard("/admin/long-window", { ...query.filters, session: query.session }, value => LongWindowSummary.parse(value), data => data.validUntil);
}

const DbTrafficData = z.object({ offline: z.array(z.object({ consumer: z.string(), run: z.string(), release: z.string(), started: z.number(), ended: z.number(), status: z.string(), rows: z.number().nullable(), logicalBytes: z.number().nullable(), dumpBytes: z.number().nullable(), snapshotBytes: z.number().nullable(), artifactBytes: z.number().nullable(), storageBytes: z.number().nullable() })).max(100), offlineTruncated: z.boolean(), generatedAt: z.number(), start: z.number(), pending: z.number(), dropped: z.number(), receivedBytes: z.number(), connections: z.number(), observedConnections: z.number(), truncated: z.boolean(), sources: z.array(z.object({ source: z.string(), queries: z.number(), failures: z.number(), rows: z.number(), queryMs: z.number(), logicalRowJsonBytes: z.number(), logicalMeasuredQueries: z.number(), unsupported: z.number(), overflow: z.number() })).max(DB_SOURCES.length), totals: z.array(z.object({ source: z.string(), template: z.string(), queries: z.number(), failures: z.number(), rows: z.number(), queryMs: z.number(), logicalRowJsonBytes: z.number(), logicalMeasuredQueries: z.number() })).max(20), byTime: z.array(z.object({ source: z.string(), template: z.string(), queries: z.number(), failures: z.number(), rows: z.number(), queryMs: z.number(), logicalRowJsonBytes: z.number(), logicalMeasuredQueries: z.number() })).max(20), byBytes: z.array(z.object({ source: z.string(), template: z.string(), queries: z.number(), failures: z.number(), rows: z.number(), queryMs: z.number(), logicalRowJsonBytes: z.number(), logicalMeasuredQueries: z.number() })).max(20), byRows: z.array(z.object({ source: z.string(), template: z.string(), queries: z.number(), failures: z.number(), rows: z.number(), queryMs: z.number(), logicalRowJsonBytes: z.number(), logicalMeasuredQueries: z.number() })).max(20), hours: z.array(z.object({ hour: z.number(), release: z.string(), deployment: z.string(), batches: z.number(), processes: z.number(), receivedBytes: z.number(), queries: z.number(), rows: z.number(), logicalRowJsonBytes: z.number(), logicalMeasuredQueries: z.number() })).max(1000) });
export async function getDbTraffic(hours: 24 | 72) {
  await requireSuperAdmin();
  return readDashboard("/admin/db-traffic", { hours: String(hours) }, value => DbTrafficData.parse(value), data => data.generatedAt + 60000);
}

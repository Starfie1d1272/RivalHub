import "server-only";
import { Agent, get } from "node:https";
import { requireSuperAdmin } from "@/lib/auth/session";
import { AnalysisData } from "./analysis-contract";
import { parseAnalysisQuery } from "./analysis-query";
import type { Analysis } from "./analysis-model";
const RESPONSE_BYTES = 1024 * 1024;
const CACHE_BYTES = 2 * RESPONSE_BYTES;
const INFLIGHT_BYTES = 4 * RESPONSE_BYTES;
const cache = new Map<string, { expires: number; body: Buffer }>();
let residentBytes = 0;
let inflightBytes = 0;
function evict(key: string) {
  const entry = cache.get(key);
  if (entry) { residentBytes -= entry.body.byteLength; cache.delete(key); }
}
function pruneCache(now: number) {
  for (const [key, entry] of cache) if (entry.expires <= now) evict(key);
}
const pending = new Map<string, Promise<QueryResult<unknown>>>();

async function queryThroughProxy(
  endpoint: URL,
  secret: string,
  proxy: URL,
): Promise<Buffer> {
  const agent = new Agent({
    proxyEnv: { NODE_ENV: process.env.NODE_ENV, HTTPS_PROXY: proxy.href },
  });
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const request = get(
        endpoint,
        {
          agent,
          headers: { Authorization: `Bearer ${secret}` },
          signal: AbortSignal.timeout(5000),
        },
        (response) => {
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
    });
  } finally {
    agent.destroy();
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
    let body: Buffer;
    if (proxyValue) {
      const proxy = new URL(proxyValue);
      if (
        !["http:", "https:"].includes(proxy.protocol) ||
        proxy.username ||
        proxy.password ||
        proxy.pathname !== "/" ||
        proxy.search ||
        proxy.hash
      )
        return { status: "unconfigured" };
      body = await queryThroughProxy(endpoint, secret, proxy);
    } else {
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${secret}` },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return { status: "unavailable" };
      const reader = response.body?.getReader();
      if (!reader) return { status: "unavailable" };
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > RESPONSE_BYTES) {
          await reader.cancel();
          return { status: "unavailable" };
        }
        chunks.push(chunk.value);
      }
      body = Buffer.concat(chunks);
    }
    const data = parse(JSON.parse(body.toString("utf8")));
    const encoded = Buffer.from(JSON.stringify(data), "utf8");
    pruneCache(Date.now());
    evict(key);
    if (encoded.byteLength <= RESPONSE_BYTES) {
      while (cache.size >= 12 || residentBytes + encoded.byteLength > CACHE_BYTES) evict(cache.keys().next().value!);
      cache.set(key, { expires: Math.min(Date.now() + 60000, validUntil(data)), body: encoded });
      residentBytes += encoded.byteLength;
    }
    return { status: "ready", data };
  } catch {
    return { status: "unavailable" };
  }
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
  return readDashboard("/admin/history", query, value => HistoryData.parse(value), data => data.generatedAt + 60000);
}


export async function getLongWindowSummary(input: unknown) {
  await requireSuperAdmin();
  const { LongWindowSummary } = await import("./long-window-contract");
  const query = parseAnalysisQuery(input);
  if (!query) throw new Error("Invalid telemetry long-window filters");
  return readDashboard("/admin/long-window", { ...query.filters, session: query.session }, value => LongWindowSummary.parse(value), data => data.validUntil);
}

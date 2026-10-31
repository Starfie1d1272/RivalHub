import "server-only";

import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { getHeapStatistics } from "node:v8";
import { withoutObservabilityContext } from "./context";
import { databaseRuntimeSlot } from "@/db/runtime-owner";
import { logEvent } from "./logger";
import { getCgroupMemorySnapshot } from "./runtime-cgroup";
import { getReadBudgetSnapshot, getStatsReadCounters, getDashboardFailureCounters } from "./read-budget";
import { flushDbTraffic } from "./db-traffic";
import { getRuntimeResourceSnapshot } from "./runtime-resources";

interface RuntimeHealthSnapshot {
  sampledAt: number;
  nodeVersion: string;
  uptimeSeconds: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
  heapLimitBytes: number;
  constrainedMemoryBytes: number | null;
  eventLoopUtilization: number;
}

/** Current application process only; memory components overlap and are not additive. */
export function getRuntimeHealthSnapshot(): RuntimeHealthSnapshot | null {
  try {
    const memory = process.memoryUsage();
    const constrained = process.constrainedMemory();
    return {
      sampledAt: Date.now(),
      nodeVersion: process.version,
      uptimeSeconds: process.uptime(),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      arrayBuffersBytes: memory.arrayBuffers,
      heapLimitBytes: getHeapStatistics().heap_size_limit,
      constrainedMemoryBytes: constrained > 0 ? constrained : null,
      eventLoopUtilization: performance.eventLoopUtilization().utilization,
    };
  } catch {
    return null;
  }
}

const SLOT = Symbol.for("rivalhub.runtime-health-sampler.v1");
type FlushHookName = "live_ingest" | "mizar_reliable_reject";
const HOOK_SLOT = Symbol.for("rivalhub.runtime-health-flush.v1");
function hooks() {
  const host = process as unknown as Record<symbol, Map<FlushHookName, () => void>>;
  return host[HOOK_SLOT] ??= new Map();
}

/** Fixed singleton key; replacement unregister cannot remove a later registration. */
export function registerRuntimeHealthFlush(name: FlushHookName, callback: () => void): () => void {
  if (name !== "live_ingest" && name !== "mizar_reliable_reject") return () => {};
  const registration = () => callback();
  hooks().set(name, registration);
  return () => { if (hooks().get(name) === registration) hooks().delete(name); };
}

type Sampler = { stop(): void };
function samplerHost() { return process as unknown as Record<symbol, Sampler | undefined>; }

/** One 60s unref timer per application process, including distinct Next graphs. */
export function startRuntimeHealthSampling(): () => void {
  const host = samplerHost();
  if (host[SLOT]) return host[SLOT].stop;
  const delay = monitorEventLoopDelay({ resolution: 20 });
  let utilization = performance.eventLoopUtilization();
  delay.enable();
  try { flushDbTraffic(); } catch { /* Traffic startup must not suppress health sampling. */ }
  // Next owns process termination; this hook only initiates a best-effort seal.
  const onTerminate = () => { try { flushDbTraffic(); } catch { /* Never prevent shutdown. */ } };
  const observesTermination = process.listenerCount("SIGTERM") > 0;
  if (observesTermination) process.on("SIGTERM", onTerminate);
  const lastStatsCounters = new Map<string, number>();
  const timer = setInterval(() => {
    try {
      withoutObservabilityContext(() => {
        for (const flush of [...hooks().values()]) {
          try { flush(); } catch { /* One hook cannot suppress other diagnostics. */ }
        }
        try { flushDbTraffic(); } catch { /* Traffic delivery must not suppress health sampling. */ }
        const snapshot = getRuntimeHealthSnapshot();
        const next = performance.eventLoopUtilization();
        const window = performance.eventLoopUtilization(next, utilization);
        utilization = next;
        if (snapshot) logEvent({ event: "runtime.health.sample", scope: "runtime", operation: "health.sample",
          safeContext: { ...snapshot, eventLoopUtilization: window.utilization,
            eventLoopDelayP99Ms: delay.count ? delay.percentile(99) / 1e6 : 0,
            eventLoopDelayMaxMs: delay.count ? delay.max / 1e6 : 0 } });
        logEvent({ event: "runtime.cgroup.sample", scope: "runtime", operation: "health.sample",
          safeContext: getCgroupMemorySnapshot() });
        const budget = getReadBudgetSnapshot();
        for (const { operation, count } of getStatsReadCounters()) {
          if (lastStatsCounters.get(operation) === count) continue;
          logEvent({ event: "runtime.read.sample", scope: "runtime", operation, safeContext: { count } });
          lastStatsCounters.set(operation, count);
        }
        for (const { operation, count, httpStatus, durationMs } of getDashboardFailureCounters()) {
          if (lastStatsCounters.get(operation) === count) continue;
          logEvent({ event: "runtime.read.sample", scope: "runtime", operation, safeContext: { count, httpStatus, durationMs } });
          lastStatsCounters.set(operation, count);
        }
        for (const { family, ...value } of budget.mizar) {
          if (value.requests || value.fullBuilds) logEvent({ event: "runtime.read.sample", scope: "runtime",
            operation: `mizar.${family}`, safeContext: value });
        }
        logEvent({ event: "runtime.read.sample", scope: "runtime",
          operation: "bet.aggregate_fallback", safeContext: { count: budget.betFallbacks } });
        const pool = databaseRuntimeSlot().snapshot();
        if (pool) {
          logEvent({ event: "runtime.pool.sample", scope: "runtime", operation: "pool.sample", safeContext: {
            poolTotal: pool.total, poolIdle: pool.idle, poolWaiting: pool.waiting, poolMax: pool.max,
            generation: pool.generation, retiringTotal: pool.retiring.total,
          } });
          const { acquire, client } = pool;
          logEvent({ event: "runtime.pool.query", scope: "runtime", operation: "pool.sample", safeContext: {
            generation: pool.generation, count: client.queries, failures: client.failures,
            returnedRows: client.rows, queryMs: client.queryMs, unsupported: client.unsupported,
          } });
          logEvent({ event: "runtime.pool.acquire", scope: "runtime", operation: "pool.sample", safeContext: {
            generation: pool.generation, count: acquire.count, failures: acquire.failures,
            totalMs: acquire.totalMs, maxMs: acquire.maxMs, reuse: acquire.states.reuse,
            connect: acquire.states.connect, queued: acquire.states.queued,
            waitingPeak: acquire.waitingPeak, waitingTotal: acquire.waitingTotal,
            bucketLe1: acquire.buckets[0], bucketLe10: acquire.buckets[1], bucketLe100: acquire.buckets[2],
            bucketLe1000: acquire.buckets[3], bucketGt1000: acquire.buckets[4],
          } });
          logEvent({ event: "runtime.pool.waiting", scope: "runtime", operation: "pool.sample", safeContext: {
            generation: pool.generation, count: acquire.waitingSamples, waitingPeak: acquire.waitingPeak, waitingTotal: acquire.waitingTotal,
            bucketLe0: acquire.waitingBuckets[0], bucketLe1: acquire.waitingBuckets[1], bucketLe4: acquire.waitingBuckets[2],
            bucketLe10: acquire.waitingBuckets[3], bucketGt10: acquire.waitingBuckets[4],
          } });
          logEvent({ event: "runtime.pool.hold", scope: "runtime", operation: "pool.sample", safeContext: {
            generation: pool.generation, count: client.checkouts, totalMs: client.holdMs, maxMs: client.holdMaxMs,
            inFlight: client.inFlight, peak: client.peak,
            bucketLe1: client.holdBuckets[0], bucketLe10: client.holdBuckets[1], bucketLe100: client.holdBuckets[2],
            bucketLe1000: client.holdBuckets[3], bucketGt1000: client.holdBuckets[4],
          } });
        }
        for (const { name, ...value } of getRuntimeResourceSnapshot()) {
          if (value.count || value.inFlight) logEvent({ event: "runtime.resource.sample", scope: "runtime",
            operation: name, safeContext: value });
        }
      });
    } catch { /* Observation must not affect application work. */ }
    finally { delay.reset(); }
  }, 60_000);
  timer.unref();
  const sampler = { stop() {
    clearInterval(timer);
    if (observesTermination) process.off("SIGTERM", onTerminate);
    delay.disable();
    if (host[SLOT] === sampler) delete host[SLOT];
  } };
  host[SLOT] = sampler;
  return sampler.stop;
}

export function stopRuntimeHealthSampling(): void { samplerHost()[SLOT]?.stop(); }

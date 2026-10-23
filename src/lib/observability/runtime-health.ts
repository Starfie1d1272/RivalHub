import "server-only";

import { performance } from "node:perf_hooks";
import { getHeapStatistics } from "node:v8";

interface RuntimeHealthSnapshot {
  sampledAt: number;
  nodeVersion: string;
  uptimeSeconds: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  heapLimitBytes: number;
  constrainedMemoryBytes: number | null;
  eventLoopUtilization: number;
}

/** On-demand process diagnostics; no sampling timer, environment values or persisted history. */
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
      heapLimitBytes: getHeapStatistics().heap_size_limit,
      constrainedMemoryBytes: constrained > 0 ? constrained : null,
      eventLoopUtilization: performance.eventLoopUtilization().utilization,
    };
  } catch {
    return null;
  }
}

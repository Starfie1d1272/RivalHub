import "server-only";

import { trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";

const FLUSH_OPTIONS = { timeoutMillis: 1_500 };

type FlushableProvider = {
  forceFlush?: (options?: typeof FLUSH_OPTIONS) => Promise<void>;
};

export async function flushObservability(): Promise<void> {
  await Promise.allSettled([
    flushProvider(trace.getTracerProvider()),
    flushProvider(logs.getLoggerProvider()),
  ]);
}

function flushProvider(provider: unknown): Promise<void> {
  try {
    const flush = (provider as FlushableProvider).forceFlush;
    if (typeof flush !== "function") return Promise.resolve();
    return Promise.resolve(flush.call(provider as FlushableProvider, FLUSH_OPTIONS));
  } catch {
    return Promise.resolve();
  }
}

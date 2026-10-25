import "server-only";

import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { BatchLogRecordProcessor, type LogRecordProcessor } from "@opentelemetry/sdk-logs";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPHttpProtoTraceExporter, registerOTel, type SpanProcessorOrName } from "@vercel/otel";
import { getBetterStackConfig, OBSERVABILITY_SERVICE_NAME } from "@/lib/observability/config";
import { getFetchInstrumentationConfig } from "@/lib/observability/instrumentation-config";
import { logEvent } from "@/lib/observability/server";
import { SanitizingSpanProcessor } from "@/lib/observability/span-sanitizer";
import { createTraceSampler } from "@/lib/observability/sampling";

import { startRuntimeHealthSampling } from "./runtime-health";

let registered = false;

export function registerNodeObservability(): void {
  if (registered) return;
  const betterStack = getBetterStackConfig();
  const spanProcessors: SpanProcessorOrName[] = [new SanitizingSpanProcessor(), "auto"];
  let logRecordProcessors: LogRecordProcessor[] | undefined;

  if (betterStack.enabled && betterStack.config) {
    const exporterConfig = {
      url: betterStack.config.tracesUrl,
      headers: betterStack.config.headers,
    };
    spanProcessors.push(new BatchSpanProcessor(new OTLPHttpProtoTraceExporter(exporterConfig)));
    logRecordProcessors = [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({
          url: betterStack.config.logsUrl,
          headers: betterStack.config.headers,
        }),
      }),
    ];
  }

  registerOTel({
    serviceName: OBSERVABILITY_SERVICE_NAME,
    spanProcessors,
    traceSampler: createTraceSampler(betterStack.environment),
    ...(logRecordProcessors ? { logRecordProcessors } : {}),
    instrumentationConfig: { fetch: getFetchInstrumentationConfig(betterStack.config) },
  });
  registered = true;
  if (process.env.NODE_ENV === "production" && process.env.NEXT_RUNTIME === "nodejs" &&
      process.env.VERCEL !== "1" && process.env.NEXT_PHASE !== "phase-production-build" &&
      process.env.RIVALHUB_RUNTIME_HEALTH_ENABLED !== "0") startRuntimeHealthSampling();

  if (betterStack.reason !== "environment_disabled") {
    logEvent({
      level: betterStack.enabled ? "info" : "warn",
      event: betterStack.enabled
        ? "observability.exporter.enabled"
        : `observability.exporter.${betterStack.reason}`,
      scope: "observability",
      operation: "configuration",
      safeContext: {
        backend: "better_stack",
        environment: betterStack.environment,
        reason: betterStack.reason,
      },
    });
  }
}

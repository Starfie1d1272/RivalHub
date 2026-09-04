import "server-only";

import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { SimpleLogRecordProcessor, type LogRecordProcessor } from "@opentelemetry/sdk-logs";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPHttpProtoTraceExporter, registerOTel, type SpanProcessorOrName } from "@vercel/otel";
import { getBetterStackConfig, OBSERVABILITY_SERVICE_NAME } from "@/lib/observability/config";
import { getFetchInstrumentationConfig } from "@/lib/observability/instrumentation-config";
import { logEvent } from "@/lib/observability/logger";

let registered = false;

export function registerNodeObservability(): void {
  if (registered) return;
  const betterStack = getBetterStackConfig();
  const spanProcessors: SpanProcessorOrName[] = ["auto"];
  let logRecordProcessors: LogRecordProcessor[] | undefined;

  if (betterStack.enabled && betterStack.config) {
    const exporterConfig = {
      url: betterStack.config.tracesUrl,
      headers: betterStack.config.headers,
    };
    spanProcessors.push(new SimpleSpanProcessor(new OTLPHttpProtoTraceExporter(exporterConfig)));
    logRecordProcessors = [
      new SimpleLogRecordProcessor({
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
    ...(logRecordProcessors ? { logRecordProcessors } : {}),
    instrumentationConfig: { fetch: getFetchInstrumentationConfig(betterStack.config) },
  });
  registered = true;

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

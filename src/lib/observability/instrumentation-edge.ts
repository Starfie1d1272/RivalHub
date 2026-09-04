import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPHttpProtoTraceExporter, registerOTel, type SpanProcessorOrName } from "@vercel/otel";
import { getBetterStackConfig, OBSERVABILITY_SERVICE_NAME } from "@/lib/observability/config";
import { getFetchInstrumentationConfig } from "@/lib/observability/instrumentation-config";

let registered = false;

export function registerEdgeObservability(): void {
  if (registered) return;
  const betterStack = getBetterStackConfig();
  const spanProcessors: SpanProcessorOrName[] = ["auto"];
  if (betterStack.enabled && betterStack.config) {
    spanProcessors.push(new SimpleSpanProcessor(new OTLPHttpProtoTraceExporter({
      url: betterStack.config.tracesUrl,
      headers: betterStack.config.headers,
    })));
  }
  registerOTel({
    serviceName: OBSERVABILITY_SERVICE_NAME,
    spanProcessors,
    instrumentationConfig: { fetch: getFetchInstrumentationConfig(betterStack.config) },
  });
  registered = true;
}

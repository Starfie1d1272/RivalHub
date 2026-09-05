import "server-only";

import { registerOTel, type SpanProcessorOrName } from "@vercel/otel";
import { OBSERVABILITY_SERVICE_NAME } from "@/lib/observability/config";
import { SanitizingSpanProcessor } from "@/lib/observability/span-sanitizer";

let registered = false;

export function registerEdgeObservability(): void {
  if (registered) return;
  const spanProcessors: SpanProcessorOrName[] = [new SanitizingSpanProcessor(), "auto"];
  registerOTel({
    serviceName: OBSERVABILITY_SERVICE_NAME,
    spanProcessors,
  });
  registered = true;
}

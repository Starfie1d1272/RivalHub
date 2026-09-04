import "server-only";

import { registerOTel, type SpanProcessorOrName } from "@vercel/otel";
import { OBSERVABILITY_SERVICE_NAME } from "@/lib/observability/config";

let registered = false;

export function registerEdgeObservability(): void {
  if (registered) return;
  const spanProcessors: SpanProcessorOrName[] = ["auto"];
  registerOTel({
    serviceName: OBSERVABILITY_SERVICE_NAME,
    spanProcessors,
  });
  registered = true;
}

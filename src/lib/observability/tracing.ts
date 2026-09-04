import "server-only";

import { context as otelContext, SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import { classifyError } from "@/lib/observability/errors";
import { extractSafeException, redactText } from "@/lib/observability/redact";

export interface TraceOptions {
  scope?: string;
  operation?: string;
  route?: string;
  provider?: string;
  attributes?: Record<string, string | number | boolean | undefined>;
}

const ALLOWED_ATTRIBUTES = new Set([
  "rivalhub.scope",
  "rivalhub.operation",
  "rivalhub.route",
  "rivalhub.provider",
  "rivalhub.workflow",
  "rivalhub.attempt",
  "rivalhub.retryable",
  "db.system",
  "db.operation",
  "http.request.method",
  "http.response.status_code",
  "error.type",
  "error.code",
  "server.address",
]);

export async function traceOperation<T>(name: string, options: TraceOptions, work: (span: Span) => Promise<T>): Promise<T> {
  const tracer = trace.getTracer("rivalhub");
  const span = tracer.startSpan(safeSpanName(name), { attributes: sanitizeSpanAttributes(options) });
  const startedAt = Date.now();
  return otelContext.with(trace.setSpan(otelContext.active(), span), async () => {
    try {
      const result = await work(span);
      try {
        span.setStatus({ code: SpanStatusCode.OK });
      } catch {
        // Span recording is best effort.
      }
      return result;
    } catch (error) {
      const classification = classifyError(error);
      const exception = extractSafeException(error, classification.pg ?? null);
      try {
        span.recordException({
          name: exception.name ?? "Error",
          ...(exception.message ? { message: exception.message } : {}),
          ...(exception.stack ? { stack: exception.stack } : {}),
        });
        span.setAttribute("error.type", classification.errorClass);
        if (classification.errorCode) span.setAttribute("error.code", classification.errorCode);
        span.setStatus({ code: SpanStatusCode.ERROR });
      } catch {
        // Span recording is best effort.
      }
      throw error;
    } finally {
      try {
        span.setAttribute("rivalhub.duration_ms", Math.max(0, Date.now() - startedAt));
        span.end();
      } catch {
        // An exporter failure must not change the operation result.
      }
    }
  });
}

function sanitizeSpanAttributes(options: TraceOptions): Record<string, string | number | boolean> {
  const attributes: Record<string, string | number | boolean> = {};
  const builtIns: Record<string, string | undefined> = {
    "rivalhub.scope": options.scope,
    "rivalhub.operation": options.operation,
    "rivalhub.route": options.route,
    "rivalhub.provider": options.provider,
  };
  for (const [key, value] of Object.entries({ ...builtIns, ...options.attributes })) {
    if (!ALLOWED_ATTRIBUTES.has(key) || value === undefined) continue;
    if (typeof value === "string") {
      const safe = redactText(value, 160).split(/[?#]/, 1)[0].replace(/[^\x20-\x7e]/g, " ").slice(0, 160);
      if (safe) attributes[key] = safe;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      attributes[key] = Math.max(-86_400_000, Math.min(86_400_000, value));
    } else if (typeof value === "boolean") {
      attributes[key] = value;
    }
  }
  return attributes;
}

function safeSpanName(value: string): string {
  return redactText(value, 96).replace(/[^A-Za-z0-9_.:/-]/g, "_").slice(0, 96) || "rivalhub.operation";
}

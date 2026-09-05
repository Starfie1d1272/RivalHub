import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { redactText } from "./redact";

const UNSAFE_ATTRIBUTE_KEY_PATTERN = /(?:^|\.)(?:db\.(?:statement|query|params?|bindings?)(?:\.|$)|http\.(?:url|target|request\.header|response\.header|request\.body|response\.body)(?:\.|$)|url\.(?:full|query)(?:\.|$)|(?:password|passwd|secret|token|authorization|cookie|session|jwt|bearer|turnstile|evidence|education|verification|formdata|base64|email|nickname|ocr)(?:\.|$))/i;

export class SanitizingSpanProcessor implements SpanProcessor {
  onStart(): void {}

  onEnd(span: ReadableSpan): void {
    try {
      sanitizeAttributes(span.attributes);
      delete (span.status as { message?: string }).message;

      for (const event of span.events) {
        sanitizeAttributes(event.attributes);
        if (event.name !== "exception" || !event.attributes) continue;

        const attributes = event.attributes as Record<string, unknown>;
        delete attributes["exception.message"];
        delete attributes["exception.stacktrace"];
        const type = attributes["exception.type"];
        if (typeof type === "string") attributes["exception.type"] = redactText(type, 120);
      }

      for (const link of span.links) sanitizeAttributes(link.attributes);
    } catch {
      // Privacy filtering is best effort and must not affect the request.
    }
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

function sanitizeAttributes(attributes: Record<string, unknown> | undefined): void {
  if (!attributes) return;
  for (const key of Object.keys(attributes)) {
    if (UNSAFE_ATTRIBUTE_KEY_PATTERN.test(key)) delete attributes[key];
  }
}

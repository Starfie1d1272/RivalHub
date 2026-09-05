import { SpanStatusCode, type Attributes } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";
import { SanitizingSpanProcessor } from "@/lib/observability/span-sanitizer";

describe("observability span sanitization", () => {
  it("removes exception details, status messages, and unsafe attributes before export", () => {
    const eventAttributes: Attributes = {
      "exception.type": "PostgreSQLError",
      "exception.message": "Failed query: select * from users where id = $1",
      "exception.stacktrace": "params: [private]",
    };
    const span = {
      attributes: {
        "db.statement": "select * from users",
        "http.url": "https://example.test/api?token=private",
        "http.response.status_code": 500,
        "rivalhub.operation": "query",
      },
      events: [{ name: "exception", attributes: eventAttributes }],
      links: [],
      status: { code: SpanStatusCode.ERROR, message: "Failed query: select * from users" },
    } as unknown as ReadableSpan;

    new SanitizingSpanProcessor().onEnd(span);

    expect(span.attributes["db.statement"]).toBeUndefined();
    expect(span.attributes["http.url"]).toBeUndefined();
    expect(span.attributes["http.response.status_code"]).toBe(500);
    expect(span.attributes["rivalhub.operation"]).toBe("query");
    expect(span.status.message).toBeUndefined();
    expect(eventAttributes["exception.message"]).toBeUndefined();
    expect(eventAttributes["exception.stacktrace"]).toBeUndefined();
    expect(eventAttributes["exception.type"]).toBe("PostgreSQLError");
  });
});

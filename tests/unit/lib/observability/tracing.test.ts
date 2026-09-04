import { trace } from "@opentelemetry/api";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { beforeEach, describe, expect, it } from "vitest";
import { traceOperation } from "@/lib/observability/tracing";

const spanExporter = new InMemorySpanExporter();
const tracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(spanExporter)],
});
trace.setGlobalTracerProvider(tracerProvider);

describe("observability tracing", () => {
  beforeEach(() => spanExporter.reset());

  it("keeps span names and attributes low-cardinality and URL-safe", async () => {
    await traceOperation("provider.lookup", {
      scope: "provider",
      operation: "lookup?token=private",
      provider: "steam",
      attributes: {
        "rivalhub.workflow": "registration",
        "rivalhub.attempt": 1,
        "user.id": "must-drop",
      },
    }, async () => undefined);
    await tracerProvider.forceFlush();

    const span = spanExporter.getFinishedSpans()[0];
    expect(span?.name).toBe("provider.lookup");
    expect(span?.attributes).toMatchObject({
      "rivalhub.scope": "provider",
      "rivalhub.operation": "lookup",
      "rivalhub.provider": "steam",
      "rivalhub.workflow": "registration",
      "rivalhub.attempt": 1,
    });
    expect(span?.attributes["user.id"]).toBeUndefined();
  });

  it("returns successful work and rethrows failed work for the action owner", async () => {
    await expect(traceOperation("test.success", {}, async () => "ok")).resolves.toBe("ok");
    await expect(traceOperation("test.failure", {}, async () => {
      throw new Error("expected failure");
    })).rejects.toThrow("expected failure");
  });
});

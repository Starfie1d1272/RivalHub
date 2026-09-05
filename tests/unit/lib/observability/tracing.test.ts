import { context, ROOT_CONTEXT, SpanStatusCode, trace, type Context, type ContextManager } from "@opentelemetry/api";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, ErrorCode } from "@/lib/errors";
import { captureException } from "@/lib/observability/logger";
import { traceOperation } from "@/lib/observability/tracing";

const spanExporter = new InMemorySpanExporter();
const tracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(spanExporter)],
});
trace.setGlobalTracerProvider(tracerProvider);

let activeContext: Context = ROOT_CONTEXT;
const contextManager: ContextManager = {
  active: () => activeContext,
  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    nextContext: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    const previousContext = activeContext;
    activeContext = nextContext;
    try {
      return fn.call(thisArg, ...args);
    } finally {
      activeContext = previousContext;
    }
  },
  bind: <T>(_context: Context, target: T) => target,
  enable() { return this; },
  disable() {
    activeContext = ROOT_CONTEXT;
    return this;
  },
};
context.setGlobalContextManager(contextManager);
afterAll(() => context.disable());

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

  it("keeps expected business outcomes out of error spans", async () => {
    const expected = new AppError(ErrorCode.VALIDATION_FAILED, "输入无效");

    await expect(traceOperation("test.expected", {}, async () => {
      throw expected;
    })).rejects.toBe(expected);
    await tracerProvider.forceFlush();

    const span = spanExporter.getFinishedSpans()[0];
    expect(span?.status.code).not.toBe(SpanStatusCode.ERROR);
    expect(span?.events).toEqual([]);
    expect(span?.attributes).toMatchObject({
      "rivalhub.error_class": "expected",
      "rivalhub.outcome": "expected",
    });
  });

  it("records unexpected failures with a safe exception and error status", async () => {
    await expect(traceOperation("test.unexpected", {}, async () => {
      throw new Error("unexpected failure");
    })).rejects.toThrow("unexpected failure");
    await tracerProvider.forceFlush();

    const span = spanExporter.getFinishedSpans()[0];
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.events).toHaveLength(1);
    expect(span?.attributes["error.type"]).toBe("application");
  });

  it("preserves an error captured while returning a handled fallback", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      await expect(traceOperation("test.handled", {}, async () => {
        captureException("test.handled_failure", new Error("handled dependency failure"), {
          scope: "test",
          operation: "handled",
          errorClass: "dependency",
        });
        return "fallback";
      })).resolves.toBe("fallback");
      await tracerProvider.forceFlush();

      const span = spanExporter.getFinishedSpans()[0];
      expect(span?.status.code).toBe(SpanStatusCode.ERROR);
      expect(span?.events).toHaveLength(1);
      expect(span?.attributes).toMatchObject({
        "rivalhub.error_class": "dependency",
      });
    } finally {
      writeSpy.mockRestore();
    }
  });
});

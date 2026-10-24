import { expect, it, vi } from "vitest";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { traceOperation } from "@/lib/observability/tracing";

it("does not let arbitrary attributes override or introduce the canonical finite stage", async () => {
  const start = vi.fn<(name: string, options: { attributes: Record<string, unknown> }) => unknown>(() => ({ setStatus() {}, setAttribute() {}, end() {}, spanContext() { return { traceId: "0".repeat(32), spanId: "0".repeat(16), traceFlags: 0 }; } }));
  const spy = vi.spyOn(trace, "getTracer").mockReturnValue({ startSpan: start } as unknown as ReturnType<typeof trace.getTracer>);
  try {
    await traceOperation("fixture", { stage: "compute", attributes: { "rivalhub.stage": "PRIVATE" } }, async () => 42);
    expect(start.mock.calls[0][1].attributes["rivalhub.stage"]).toBe("compute");
    await traceOperation("fixture", { attributes: { "rivalhub.stage": "PRIVATE" } }, async () => 42);
    expect(start.mock.calls[1][1].attributes).not.toHaveProperty("rivalhub.stage");
  } finally { spy.mockRestore(); }
});

it("preserves a handled error marked by a shared guard from another runtime graph", async () => {
  vi.resetModules(); const guardGraph = await import("@/lib/observability/tracing");
  vi.resetModules(); const requestGraph = await import("@/lib/observability/tracing");
  const status = vi.fn();
  const span = { setStatus: status, setAttribute() {}, end() {} };
  const spy = vi.spyOn(trace, "getTracer").mockReturnValue({ startSpan: () => span } as unknown as ReturnType<typeof trace.getTracer>);
  try {
    expect(await requestGraph.traceOperation("fixture", {}, async () => {
      guardGraph.markSpanErrored(span as unknown as Parameters<typeof guardGraph.markSpanErrored>[0]);
      span.setStatus({ code: SpanStatusCode.ERROR });
      return "handled";
    })).toBe("handled");
    expect(status.mock.calls.at(-1)?.[0]).toEqual({ code: SpanStatusCode.ERROR });
  } finally { spy.mockRestore(); }
});

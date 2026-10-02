import { ROOT_CONTEXT, SpanKind, TraceFlags, trace, type Attributes } from "@opentelemetry/api";
import { SamplingDecision } from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";
import { createTraceSampler } from "@/lib/observability/sampling";

const sampledId = "00000001000000000000000000000000";
const droppedId = "80000000000000000000000000000000";
const cronAttributes = { "http.method": "GET", "http.target": "/api/cron/draft-timeout", "next.span_type": "BaseServer.handleRequest" };

function decide(environment: string, traceId: string, attributes: Attributes, parent = ROOT_CONTEXT, kind = SpanKind.SERVER) {
  return createTraceSampler(environment).shouldSample(parent, traceId, "GET", kind, attributes, []).decision;
}

describe("request trace sampling", () => {
  it("samples the Next request before the final route/name is available", () => {
    expect(decide("production", sampledId, cronAttributes)).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    expect(decide("production", droppedId, cronAttributes)).toBe(SamplingDecision.NOT_RECORD);
    expect(decide("production", droppedId, { ...cronAttributes, "http.target": "/api/cron/draft-timeout?ignored=value" })).toBe(SamplingDecision.NOT_RECORD);
  });

  it("retains 5% of a deterministic uniform trace-id corpus", () => {
    let retained = 0;
    for (let index = 0; index < 10000; index++) {
      const id = Math.floor((index + 0.5) * 0x100000000 / 10000).toString(16).padStart(8, "0") + "000000000000000000000000";
      if (decide("production", id, cronAttributes) === SamplingDecision.RECORD_AND_SAMPLED) retained++;
    }
    expect(retained).toBe(500);
  });

  it.each(["preview", "development", "test", "unknown"])("retains non-production request traces in %s", (environment) => {
    expect(decide(environment, droppedId, cronAttributes)).toBe(SamplingDecision.RECORD_AND_SAMPLED);
  });

  it.each([{}, { "http.target": "/teams" }, { "http.target": "/api/cronish/test" }, { "http.target": "/teams?next=/api/cron/job" }])("keeps unknown and non-cron roots", (attributes) => {
    expect(decide("production", droppedId, attributes)).toBe(SamplingDecision.RECORD_AND_SAMPLED);
  });

  it.each([TraceFlags.NONE, TraceFlags.SAMPLED])("local children follow parent flags %s even when their route differs", (traceFlags) => {
    const parent = trace.setSpanContext(ROOT_CONTEXT, { traceId: droppedId, spanId: "1111111111111111", traceFlags });
    const expected = traceFlags === TraceFlags.SAMPLED ? SamplingDecision.RECORD_AND_SAMPLED : SamplingDecision.NOT_RECORD;
    expect(decide("production", droppedId, {}, parent, SpanKind.INTERNAL)).toBe(expected);
    expect(decide("production", droppedId, cronAttributes, parent)).toBe(expected);
  });

  it.each([TraceFlags.NONE, TraceFlags.SAMPLED])("incoming remote flags %s do not override the local request policy", (traceFlags) => {
    const parent = trace.setSpanContext(ROOT_CONTEXT, { traceId: droppedId, spanId: "1111111111111111", traceFlags, isRemote: true });
    expect(decide("production", droppedId, cronAttributes, parent)).toBe(SamplingDecision.NOT_RECORD);
    expect(decide("production", droppedId, { "http.target": "/teams" }, parent)).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    expect(decide("preview", droppedId, cronAttributes, parent)).toBe(SamplingDecision.RECORD_AND_SAMPLED);
  });

  it("fails open without reading sensitive attributes", () => {
    const attributes = Object.defineProperty({}, "http.target", { get() { throw new Error("invalid instrumentation"); } });
    expect(decide("production", droppedId, attributes)).toBe(SamplingDecision.RECORD_AND_SAMPLED);
    const safe = Object.defineProperty({ ...cronAttributes }, "http.request.header.authorization", { get() { throw new Error("must not read"); } });
    expect(decide("production", droppedId, safe)).toBe(SamplingDecision.NOT_RECORD);
  });
});

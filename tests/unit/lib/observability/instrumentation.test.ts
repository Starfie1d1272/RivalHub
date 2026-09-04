import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registerOTel: vi.fn(),
  batchSpanProcessor: vi.fn(),
  batchLogRecordProcessor: vi.fn(),
  traceExporter: vi.fn(),
  logExporter: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@vercel/otel", () => ({
  registerOTel: mocks.registerOTel,
  OTLPHttpProtoTraceExporter: mocks.traceExporter,
}));

vi.mock("@opentelemetry/sdk-trace-base", () => ({
  BatchSpanProcessor: mocks.batchSpanProcessor,
}));

vi.mock("@opentelemetry/sdk-logs", () => ({
  BatchLogRecordProcessor: mocks.batchLogRecordProcessor,
}));

vi.mock("@opentelemetry/exporter-logs-otlp-proto", () => ({
  OTLPLogExporter: mocks.logExporter,
}));

vi.mock("@/lib/observability/server", () => ({
  logEvent: mocks.logEvent,
}));

describe("observability runtime registration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("BETTER_STACK_SOURCE_TOKEN", "source-token");
    vi.stubEnv("BETTER_STACK_INGESTING_HOST", "logs.example.com");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("uses batched Better Stack processors only in Node runtime", async () => {
    const { registerNodeObservability } = await import("@/lib/observability/instrumentation-node");

    registerNodeObservability();

    const options = mocks.registerOTel.mock.calls[0]?.[0] as {
      spanProcessors: unknown[];
      logRecordProcessors?: unknown[];
    };
    expect(options.spanProcessors).toHaveLength(2);
    expect(options.spanProcessors[0]).toBe("auto");
    expect(mocks.traceExporter).toHaveBeenCalledWith({
      url: "https://logs.example.com/v1/traces",
      headers: { Authorization: "Bearer source-token" },
    });
    expect(mocks.batchSpanProcessor).toHaveBeenCalledOnce();
    expect(options.logRecordProcessors).toHaveLength(1);
    expect(mocks.logExporter).toHaveBeenCalledWith({
      url: "https://logs.example.com/v1/logs",
      headers: { Authorization: "Bearer source-token" },
    });
    expect(mocks.batchLogRecordProcessor).toHaveBeenCalledOnce();
  });

  it("keeps Edge on the Vercel auto processor without an external exporter", async () => {
    const { registerEdgeObservability } = await import("@/lib/observability/instrumentation-edge");

    registerEdgeObservability();

    expect(mocks.registerOTel).toHaveBeenCalledWith({
      serviceName: "rivalhub",
      spanProcessors: ["auto"],
    });
    expect(mocks.traceExporter).not.toHaveBeenCalled();
    expect(mocks.logExporter).not.toHaveBeenCalled();
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });

  it("does not create external processors when the environment is disabled", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "");
    const { registerNodeObservability } = await import("@/lib/observability/instrumentation-node");

    registerNodeObservability();

    const options = mocks.registerOTel.mock.calls[0]?.[0] as { spanProcessors: unknown[]; logRecordProcessors?: unknown[] };
    expect(options.spanProcessors).toEqual(["auto"]);
    expect(options.logRecordProcessors).toBeUndefined();
    expect(mocks.traceExporter).not.toHaveBeenCalled();
    expect(mocks.logExporter).not.toHaveBeenCalled();
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });
});

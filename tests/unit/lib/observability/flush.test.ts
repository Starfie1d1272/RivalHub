import { beforeEach, describe, expect, it, vi } from "vitest";

const providers = vi.hoisted(() => ({
  trace: { forceFlush: vi.fn(() => Promise.resolve()) },
  logs: { forceFlush: vi.fn(() => Promise.resolve()) },
}));

vi.mock("server-only", () => ({}));
vi.mock("@opentelemetry/api", () => ({
  trace: { getTracerProvider: () => providers.trace },
}));
vi.mock("@opentelemetry/api-logs", () => ({
  logs: { getLoggerProvider: () => providers.logs },
}));

import { flushObservability } from "@/lib/observability/flush";

describe("observability flush", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flushes trace and log providers with a bounded timeout", async () => {
    await expect(flushObservability()).resolves.toBeUndefined();

    expect(providers.trace.forceFlush).toHaveBeenCalledWith({ timeoutMillis: 1_500 });
    expect(providers.logs.forceFlush).toHaveBeenCalledWith({ timeoutMillis: 1_500 });
  });

  it("swallows provider flush failures", async () => {
    providers.trace.forceFlush.mockRejectedValueOnce(new Error("trace sink unavailable"));
    providers.logs.forceFlush.mockRejectedValueOnce(new Error("log sink unavailable"));

    await expect(flushObservability()).resolves.toBeUndefined();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  flushObservability: vi.fn(() => Promise.resolve()),
  logEvent: vi.fn(),
  traceOperation: vi.fn(async (_name: string, _options: unknown, work: (span: { setAttribute: ReturnType<typeof vi.fn> }) => Promise<Response>) => work({ setAttribute: vi.fn() })),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/observability/server", () => ({
  flushObservability: mocks.flushObservability,
  logEvent: mocks.logEvent,
  traceOperation: mocks.traceOperation,
}));

import { withRouteObservability } from "@/lib/observability/route";

describe("route observability", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flushes batched providers after the response without changing it", async () => {
    const response = new Response(null, { status: 401 });
    const result = await withRouteObservability(
      new Request("https://example.test/api/cron/check-registration-deadline"),
      "/api/cron/check-registration-deadline",
      async () => response,
    );

    expect(result).toBe(response);
    expect(mocks.after).toHaveBeenCalledOnce();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.flushObservability).toHaveBeenCalledOnce();
  });
});

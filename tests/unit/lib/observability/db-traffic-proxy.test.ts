import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ options: undefined as unknown, target: undefined as unknown, body: "", agentOptions: undefined as unknown }));
vi.mock("node:https", () => ({
  Agent: class { constructor(options: unknown) { calls.agentOptions = options; } destroy() {} },
  request: (target: unknown, options: unknown, callback: (response: unknown) => void) => {
    calls.target = target; calls.options = options;
    const req = new EventEmitter() as EventEmitter & { end(body: string): void };
    req.end = (body) => { calls.body = body; callback({ statusCode: 204, resume() {} }); };
    return req;
  },
}));

it("uses the configured HTTPS proxy for authenticated database telemetry", async () => {
  const { flushDbTraffic, recordDbTraffic } = await import("@/lib/observability/db-traffic");
  const host = process as unknown as Record<symbol, unknown>;
  const slot = Symbol.for("rivalhub.db-traffic.v2"); delete host[slot];
  vi.stubEnv("DB_TRAFFIC_KEY", "test-key-".repeat(5));
  vi.stubEnv("PRODUCT_TELEMETRY_ENDPOINT", "https://telemetry.invalid/v1/batches");
  vi.stubEnv("PRODUCT_TELEMETRY_QUERY_PROXY_URL", "http://127.0.0.1:7890");
  const direct = vi.fn(); vi.stubGlobal("fetch", direct);
  try {
    recordDbTraffic("unknown", "unknown", 1, 1, false); flushDbTraffic();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(String(calls.target)).toBe("https://telemetry.invalid/v1/db-traffic");
    expect(calls.agentOptions).toMatchObject({ proxyEnv: { HTTPS_PROXY: "http://127.0.0.1:7890/" } });
    expect(calls.options).toMatchObject({ method: "POST", headers: { authorization: `Bearer ${"test-key-".repeat(5)}` } });
    expect(JSON.parse(calls.body).rows).toHaveLength(1);
    expect(direct).not.toHaveBeenCalled();
  } finally { delete host[slot]; vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
});

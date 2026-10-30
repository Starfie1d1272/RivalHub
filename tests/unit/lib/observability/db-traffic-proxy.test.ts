import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ options: undefined as unknown, target: undefined as unknown, body: "", agentOptions: undefined as unknown }));
vi.mock("node:https", () => ({
  Agent: class { constructor(options: unknown) { calls.agentOptions = options; } destroy() {} },
  request: (target: unknown, options: unknown, callback: (response: unknown) => void) => {
    calls.target = target; calls.options = options;
    const req = new EventEmitter() as EventEmitter & { end(body: string): void };
    req.end = (body) => { calls.body = body; void (async () => {
      const { digestDbTraffic } = await import("@/lib/observability/db-traffic-contract");
      const parsed = JSON.parse(body); const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: {} });
      callback(response); response.emit("data", Buffer.from(JSON.stringify({ protocol: 2, id: parsed.id, digest: await digestDbTraffic(parsed), status: "accepted" }))); response.emit("end");
    })(); };
    return req;
  },
}));

it("reads a bounded v2 acknowledgement through the configured HTTPS proxy", async () => {
  const { flushDbTraffic, recordDbTraffic } = await import("@/lib/observability/db-traffic");
  const host = process as unknown as Record<symbol, unknown>;
  const slot = Symbol.for("rivalhub.db-traffic.v3"); delete host[slot];
  const root = await mkdtemp(join(tmpdir(), "traffic-proxy-"));
  vi.stubEnv("DB_TRAFFIC_KEY", "test-key-".repeat(5));
  vi.stubEnv("PRODUCT_TELEMETRY_ENDPOINT", "https://telemetry.invalid/v1/batches");
  vi.stubEnv("PRODUCT_TELEMETRY_QUERY_PROXY_URL", "http://127.0.0.1:7890");
  vi.stubEnv("DB_TRAFFIC_SPOOL_DIRECTORY", root);
  const direct = vi.fn(); vi.stubGlobal("fetch", direct);
  try {
    recordDbTraffic("unknown", "unknown", 1, 1, false); flushDbTraffic();
    await vi.waitFor(() => expect(calls.body).not.toBe(""));
    expect(String(calls.target)).toBe("https://telemetry.invalid/v1/db-traffic");
    expect(calls.agentOptions).toMatchObject({ proxyEnv: { HTTPS_PROXY: "http://127.0.0.1:7890/" } });
    expect(calls.options).toMatchObject({ method: "POST", headers: { authorization: `Bearer ${"test-key-".repeat(5)}`, "x-db-traffic-protocol": "2" } });
    expect(JSON.parse(calls.body).rows).toHaveLength(1);
    expect(direct).not.toHaveBeenCalled();
    await vi.waitFor(() => expect((host[slot] as { sending: boolean }).sending).toBe(false));
  } finally { delete host[slot]; vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }); }
});

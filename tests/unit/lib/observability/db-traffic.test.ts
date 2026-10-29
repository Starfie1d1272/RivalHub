import { expect, it } from "vitest";
import { queryShape } from "@/lib/observability/db-traffic";

it("distinguishes identifiers while normalizing literals, comments and parameters", () => {
  const first = queryShape("select account from users where id = $1 and name = 'secret-one'");
  expect(first).toMatch(/^q[0-9a-f]{16}$/);
  expect(queryShape("select account from users where id = $2 and name = 'secret-two'")).toBe(first);
  expect(queryShape("select account from profiles where id = $2 and name = 'secret-two'")).not.toBe(first);
  expect(queryShape("select account from users where id = $1")).not.toBe(first);
  expect(queryShape("-- secret-one\nselect 'secret-two'")).toBe(queryShape("select 'other'"));
  expect(queryShape("select " + "a,".repeat(4097))).toBe("unknown");
  expect(queryShape(String.raw`select E'one\'secret' from records`)).toBe(queryShape(String.raw`select E'two\'private' from records`));
});

it("bounds the retry queue, preserves FIFO identity and reports a dropped window", async () => {
  const { vi } = await import("vitest");
  const { recordDbTraffic, flushDbTraffic } = await import("@/lib/observability/db-traffic");
  const host = process as unknown as Record<symbol, unknown>;
  const slot = Symbol.for("rivalhub.db-traffic.v2"); delete host[slot];
  vi.stubEnv("DB_TRAFFIC_KEY", "fixture-secret".repeat(3));
  vi.stubEnv("PRODUCT_TELEMETRY_ENDPOINT", "https://telemetry.invalid/v1/batches");
  const sent: Array<{ id: string; dropped: number }> = []; let succeeds = false;
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: { body: string }) => { sent.push(JSON.parse(init.body)); return new Response(null, { status: succeeds ? 204 : 503 }); }));
  const settle = () => new Promise<void>(resolve => setImmediate(resolve));
  try {
    for (let i = 0; i < 6; i++) { recordDbTraffic("unknown", "unknown", 0, 1, false); flushDbTraffic(); await settle(); }
    expect(new Set(sent.map(row => row.id)).size).toBe(1);
    succeeds = true; flushDbTraffic(); await settle();
    recordDbTraffic("unknown", "unknown", 0, 1, false); flushDbTraffic(); await settle();
    for (let i = 0; i < 4; i++) { flushDbTraffic(); await settle(); }
    expect(sent.at(-1)?.dropped).toBe(1);
    expect(new Set(sent.map(row => row.id)).size).toBe(6);
  } finally { delete host[slot]; vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
});

it("does not retain disabled observations for later delivery", async () => {
  const { vi } = await import("vitest");
  const { recordDbTraffic, flushDbTraffic } = await import("@/lib/observability/db-traffic");
  const host = process as unknown as Record<symbol, unknown>;
  const slot = Symbol.for("rivalhub.db-traffic.v2"); delete host[slot];
  vi.stubEnv("DB_TRAFFIC_KEY", "");
  vi.stubEnv("PRODUCT_TELEMETRY_ENDPOINT", "https://telemetry.invalid/v1/batches");
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  try {
    recordDbTraffic("unknown", "unknown", 0, 1, false);
    flushDbTraffic();
    vi.stubEnv("DB_TRAFFIC_KEY", "fixture-secret".repeat(3));
    flushDbTraffic();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(fetchMock).not.toHaveBeenCalled();
  } finally { delete host[slot]; vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
});

import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { flushDbTraffic, observeDbStream } from "@/lib/observability/db-traffic";
import { preparePgTraffic } from "@/lib/observability/pg-traffic-adapter";

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const slot = Symbol.for("rivalhub.db-traffic.v3");
const host = process as unknown as Record<symbol, unknown>;
function setup() {
  delete host[slot];
  vi.stubEnv("DB_TRAFFIC_KEY", "fixture-secret".repeat(3));
  vi.stubEnv("PRODUCT_TELEMETRY_ENDPOINT", "https://telemetry.invalid/v1/batches");
  vi.stubEnv("PRODUCT_TELEMETRY_QUERY_PROXY_URL", "");
  const stream = new EventEmitter();
  const connection = Object.assign(new EventEmitter(), { stream, attachListeners: (stream: EventEmitter) => { void stream; } });
  const client = Object.assign(new EventEmitter(), { connection });
  preparePgTraffic(client as unknown as Parameters<typeof preparePgTraffic>[0]);
  connection.attachListeners(stream);
  observeDbStream(client as unknown as Parameters<typeof observeDbStream>[0]);
  const receive = (bytes: number) => { stream.emit("data", Buffer.alloc(bytes)); connection.emit("message", { name: "commandComplete", length: bytes - 1 }); };
  return { receive };
}
function cleanup() { delete host[slot]; vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); }

type Batch = { dropped: number; droppedReceivedBytes: number; unconfirmedBatches: number; unconfirmedReceivedBytes: number; receivedBytes: number; at: number; remaining: { unsupported: number; no_owner: number } };
it("reports the exact received bytes of a window discarded by a full queue", async () => {
  const { receive } = setup(); const sent: Batch[] = []; let accept = false;
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: { body: string }) => { sent.push(JSON.parse(init.body)); return new Response(null, { status: accept ? 204 : 503 }); }));
  try {
    for (let n = 11; n <= 16; n++) { receive(n); flushDbTraffic(); await settle(); }
    expect(sent[0].remaining).toMatchObject({ unsupported: 11, no_owner: 0 });
    accept = true;
    for (let n = 0; n < 7; n++) { flushDbTraffic(); await settle(); }
    expect(sent).toContainEqual(expect.objectContaining({ dropped: 1, droppedReceivedBytes: 16, unconfirmedBatches: 0, unconfirmedReceivedBytes: 0 }));
  } finally { cleanup(); }
});

it("reports an attempted expired batch as unconfirmed and an unattempted one as lost", async () => {
  let now = 1_800_000_000_000; vi.spyOn(Date, "now").mockImplementation(() => now);
  const { receive } = setup(); const sent: Batch[] = []; let accept = false;
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: { body: string }) => { sent.push(JSON.parse(init.body)); return new Response(null, { status: accept ? 204 : 503 }); }));
  try {
    receive(11); flushDbTraffic(); await settle();
    receive(12); flushDbTraffic(); await settle();
    now += 24 * 3600000; accept = true; flushDbTraffic(); await settle();
    expect(sent.at(-1)).toMatchObject({ dropped: 1, droppedReceivedBytes: 12, unconfirmedBatches: 1, unconfirmedReceivedBytes: 11, receivedBytes: 0, at: now });
  } finally { cleanup(); }
});

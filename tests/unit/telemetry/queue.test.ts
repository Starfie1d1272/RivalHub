import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TelemetryQueue } from "@/lib/telemetry/queue";
import { LIMITS, safeFilters, validEvent, type Bootstrap, type TelemetryEvent } from "@/lib/telemetry/protocol";
const session = crypto.randomUUID();
const event = (extra: Partial<TelemetryEvent> = {}): TelemetryEvent => ({ id: crypto.randomUUID(), at: Date.now(), session, route: "/", scene: "site", kind: "page", ...extra });
const config = (): Bootstrap => ({ ticket: "fixture", endpoint: "https://receiver.invalid/v1/batches", identity: "a", expiresAt: Date.now() + 86400000 });
const ack = () => new Response(null, { status: 204 });
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });
async function drain(q: TelemetryQueue, n = 40) { for (let i = 0; i < n; i++) { await q.flush(); vi.advanceTimersByTime(1000); } }

it.each([31, 32, 33])("delivers %i events within count/envelope budgets", async n => {
  const send = vi.fn().mockImplementation(ack); const q = new TelemetryQueue(config(), send);
  for (let i = 0; i < n; i++) q.add(event());
  await drain(q);
  const bodies = send.mock.calls.map(c => JSON.parse(c[1].body));
  expect(bodies.flatMap(b => b.events)).toHaveLength(n);
  expect(bodies.map(b => b.events.length)).toEqual(n <= 32 ? [n] : [32, 1]);
});

it("packs exact UTF8 envelopes and drops only an individually oversized item", async () => {
  const send = vi.fn().mockImplementation(ack); const cfg = config(); const q = new TelemetryQueue(cfg, send);
  const large = event({ route: "中".repeat(LIMITS.bytes) });
  const small = Array.from({ length: 33 }, () => event({ route: "中".repeat(500) }));
  q.add(large); small.forEach(e => q.add(e)); await drain(q);
  const bodies = send.mock.calls.map(c => c[1].body as string);
  expect(bodies.every(b => Buffer.byteLength(b) <= LIMITS.bytes)).toBe(true);
  expect(bodies.flatMap(b => JSON.parse(b).events).map(e => e.id)).toEqual(small.map(e => e.id));
  expect(q.delivery.batch_oversize).toBe(1);
  expect(q.metrics.dropped).toBe(1);
});

it.each([0, 1])("honors the exact envelope byte boundary plus %i", async extra => {
  const cfg = config(); const e = event();
  const overhead = Buffer.byteLength(JSON.stringify({ v: 1, ticket: cfg.ticket, id: crypto.randomUUID(), events: [e] }));
  e.route = "/" + "x".repeat(LIMITS.bytes - overhead + extra);
  const send = vi.fn().mockImplementation(ack); const q = new TelemetryQueue(cfg, send); q.add(e); q.add(event()); await drain(q);
  expect(q.delivery.batch_oversize).toBe(extra);
  expect(send.mock.calls.flatMap(c => JSON.parse(c[1].body).events)).toHaveLength(extra ? 1 : 2);
  if (!extra) expect(Buffer.byteLength(send.mock.calls[0][1].body)).toBe(LIMITS.bytes);
});

it("keeps sessions separate and delivers the real validEvent set without relaxing filters", async () => {
  const send = vi.fn().mockImplementation(ack); const q = new TelemetryQueue(config(), send);
  const views = ["open", "mine", "settled", "event", "leaderboard", "records", "sim", "points", "record", "tasks", "ranking"];
  const events = views.map(view => event({ filters: safeFilters(new URLSearchParams({ view, q: "PRIVATE" })) }));
  events.push(event({ session: crypto.randomUUID() }));
  expect(events.every(e => validEvent(e, Date.now()))).toBe(true);
  expect(events.slice(0, -1).map(e => e.filters?.view)).toEqual(views);
  expect(validEvent(event({ filters: { view: "PRIVATE" } }), Date.now())).toBe(false);
  events.forEach(e => q.add(e)); await drain(q);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls.every(c => new Set(JSON.parse(c[1].body).events.map((e: TelemetryEvent) => e.session)).size === 1)).toBe(true);
});

it("retries the identical body and endpoint through same-identity renewal", async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementation(ack);
  const cfg = config(); const q = new TelemetryQueue(cfg, send); q.add(event()); await q.flush();
  q.configure({ ...cfg, ticket: "renewed", endpoint: "https://other.invalid/v1/batches" });
  q.add(event()); await q.flush(); expect(send).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(60000); await q.flush();
  expect(send.mock.calls[1][0]).toBe(send.mock.calls[0][0]);
  expect(send.mock.calls[1][1].body).toBe(send.mock.calls[0][1].body);
  vi.advanceTimersByTime(1000); await q.flush();
  expect(JSON.parse(send.mock.calls[2][1].body).ticket).toBe("renewed");
});

it("expires an unacknowledged old ticket without reticketing its batch", async () => {
  const cfg = { ...config(), expiresAt: Date.now() + 1000 };
  const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementation(ack);
  const q = new TelemetryQueue(cfg, send); q.add(event()); await q.flush();
  vi.advanceTimersByTime(1000); q.configure({ ...cfg, ticket: "renewed", expiresAt: Date.now() + 86400000 });
  q.add(event()); vi.advanceTimersByTime(60000); await q.flush();
  expect(send).toHaveBeenCalledTimes(2); expect(q.delivery.ticket_expired).toBe(1);
  expect(JSON.parse(send.mock.calls[1][1].body).id).not.toBe(JSON.parse(send.mock.calls[0][1].body).id);
});

it.each([400, 401, 403, 413])("never retries permanent HTTP %i", async status => {
  const send = vi.fn().mockResolvedValue(new Response(null, { status })); const cfg = config(); const q = new TelemetryQueue(cfg, send);
  q.add(event()); await q.flush(); await drain(q); expect(send).toHaveBeenCalledTimes(1);
  if (status === 401) {
    q.add(event()); await q.flush(); expect(send).toHaveBeenCalledTimes(1);
    q.configure({ ...cfg, ticket: "renewed" }); send.mockImplementation(ack); await q.flush();
    expect(send).toHaveBeenCalledTimes(2);
  }
});

it.each([429, 500, 503, "network"])("bounds %s retries to three identical requests", async status => {
  const send = status === "network" ? vi.fn().mockRejectedValue(new Error("offline")) : vi.fn().mockImplementation(() => new Response(null, { status: Number(status), headers: { "Retry-After": "120" } }));
  const q = new TelemetryQueue(config(), send); q.add(event()); await q.flush();
  vi.advanceTimersByTime(59999); await q.flush(); expect(send).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 5; i++) { vi.advanceTimersByTime(240000); await q.flush(); }
  expect(send).toHaveBeenCalledTimes(3);
  expect(new Set(send.mock.calls.map(c => c[1].body)).size).toBe(1);
  expect(q.delivery.retry_exhausted).toBe(1);
});

it.each([
  ["120", 120000], ["0", 60000], ["-1", 60000], ["invalid", 60000],
])("honors Retry-After %s without an earlier request", async (header, delay) => {
  const send = vi.fn().mockImplementation(() => new Response(null, { status: 429, headers: { "Retry-After": header } }));
  const q = new TelemetryQueue(config(), send); q.add(event()); await q.flush();
  vi.advanceTimersByTime(Number(delay) - 1); await q.flush(); expect(send).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1); await q.flush(); expect(send).toHaveBeenCalledTimes(2);
});

it("honors HTTP-date, remaining attempts and subsequent batches after rate rejection", async () => {
  const start = Math.floor(Date.now() / 1000) * 1000; vi.setSystemTime(start);
  const send = vi.fn().mockImplementation(() => new Response(null, { status: 429, headers: { "Retry-After": new Date(start + 300000).toUTCString() } }));
  const q = new TelemetryQueue(config(), send); q.add(event()); await q.flush();
  vi.advanceTimersByTime(299999); await q.flush(); expect(send).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1); await q.flush();
  vi.advanceTimersByTime(120000); await q.flush(); expect(send).toHaveBeenCalledTimes(3);
  expect(q.delivery.retry_exhausted).toBe(1);
  q.add(event()); await q.flush(); expect(send).toHaveBeenCalledTimes(3);
  vi.advanceTimersByTime(240000); send.mockImplementation(ack); await q.flush(); expect(send).toHaveBeenCalledTimes(4);
});

it.each(["999999999", "99999999999999999999999999999999999"])("drops an impossible delayed batch but never bypasses Retry-After %s", async header => {
  const send = vi.fn().mockImplementation(() => new Response(null, { status: 429, headers: { "Retry-After": header } }));
  const cfg = config(); const q = new TelemetryQueue(cfg, send);
  for (let i = 0; i < 257; i++) q.add(event());
  expect(send).not.toHaveBeenCalled(); expect(q.delivery.queue_dropped).toBe(1);
  await q.flush(); expect(q.delivery.retry_exhausted).toBe(32);
  q.configure({ ...cfg, ticket: "renewed" });
  vi.advanceTimersByTime(LIMITS.ageMs + 1); q.add(event()); await q.flush(); expect(send).toHaveBeenCalledTimes(1);
});

it("clears old identity work even when its response is in flight", async () => {
  let resolve!: (r: Response) => void;
  const send = vi.fn().mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; })).mockImplementation(ack);
  const cfg = config(); const q = new TelemetryQueue(cfg, send); q.add(event()); const active = q.flush();
  q.configure({ ...cfg, identity: "b", ticket: "other" }); q.add(event());
  resolve(ack()); await active; await q.flush();
  expect(q.delivery.identity_reset).toBe(1);
  expect(JSON.parse(send.mock.calls[1][1].body).ticket).toBe("other");
});

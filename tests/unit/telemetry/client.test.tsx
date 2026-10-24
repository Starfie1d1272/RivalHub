import { afterEach, expect, it, vi } from "vitest";
import { beginTelemetryNavigation, captureTelemetryNavigation, recordContentReady, configureTelemetry, flushTelemetry, observeAction, recordPage, recordWebVital, renewTelemetryIfNeeded, resetTelemetryIdentity, setTelemetryScene } from "@/lib/telemetry/client";
import { TelemetryQueue } from "@/lib/telemetry/queue";
import type { Bootstrap, TelemetryEvent } from "@/lib/telemetry/protocol";

const config: Bootstrap = { endpoint: "https://receiver.invalid/v1/batches", ticket: "transport-only", identity: "fixture", expiresAt: Date.now() + 86400000 };
afterEach(() => { resetTelemetryIdentity(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });
it("correlates the real ActionResult, excludes input/response/error text, and leaves throws unchanged", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher); configureTelemetry(config);
  const failure = { success: false, error: { code: "FORBIDDEN", message: "PRIVATE", requestId: crypto.randomUUID() } };
  const call = observeAction("captains.castVote", async (...args: [string]) => { expect(args).toEqual(["PASSWORD"]); return failure; });
  expect(await call("PASSWORD")).toBe(failure);
  const thrown = new Error("SECRET");
  await expect(observeAction("captains.castVote", async () => { throw thrown; })()).rejects.toBe(thrown);
  flushTelemetry(); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const sent = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(sent.events.map((e: TelemetryEvent) => e.phase)).toEqual(["start", "rejected", "start", "unknown"]);
  expect(sent.events[0].operationId).toBe(sent.events[1].operationId);
  expect(sent.events[2].operationId).toBe(sent.events[3].operationId);
  expect(sent.events[1].requestId).toBe(failure.error.requestId);
  expect(JSON.stringify(sent)).not.toMatch(/PRIVATE|PASSWORD|SECRET/);
});
it("does not capture while disabled and does not call a server action twice", async () => {
  configureTelemetry(null);
  const action = vi.fn().mockResolvedValue({ success: true, data: undefined });
  await observeAction("captains.castVote", action)(); recordPage(); flushTelemetry();
  expect(action).toHaveBeenCalledTimes(1);
});
it("treats a stale BP receipt as rejected and keeps the actual result", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher); configureTelemetry(config);
  const result = { success: true, data: { outcome: "stale", room: { private: "PRIVATE" } } };
  expect(await observeAction("matches.veto-room.performVetoRoomCommand", async () => result)()).toBe(result);
  flushTelemetry(); await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[0][1].body).events[1]).toMatchObject({ phase: "rejected", outcome: "stale" });
});
it("batches 100 events, bounds retries with a stable batch ID, and recovers without blocking collection", async () => {
  vi.useFakeTimers(); const send = vi.fn().mockRejectedValue(new Error("offline"));
  const q = new TelemetryQueue(config, send);
  for (let i = 0; i < 100; i++) q.add({ id: crypto.randomUUID(), at: Date.now(), session: "00000000-0000-0000-0000-000000000001", route: "/", scene: "site", kind: "page" });
  expect(send).not.toHaveBeenCalled();
  await q.flush(); expect(send).toHaveBeenCalledTimes(1);
  await q.flush(); expect(send).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(60000); send.mockResolvedValue(new Response(null, { status: 204 }));
  await q.flush();
  expect(JSON.parse(send.mock.calls[0][1].body).id).toBe(JSON.parse(send.mock.calls[1][1].body).id);
  for (let i = 0; i < 3; i++) { vi.advanceTimersByTime(60000); await q.flush(); }
  expect(send).toHaveBeenCalledTimes(5); // 4 batches + one lost delivery
  expect(q.metrics.events).toBe(100); expect(q.metrics.failures).toBe(1);
});
it("keeps a 26-hour same-page active session collecting with one automatic renewal, not one call per action", async () => {
  vi.useFakeTimers(); const start = Date.now();
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal("fetch", send);
  configureTelemetry({ ...config, expiresAt: start + 86400000 });
  const renew = vi.fn(async () => ({ ...config, ticket: "renewed-ticket", expiresAt: Date.now() + 86400000 }));
  const action = observeAction("captains.castVote", async () => ({ success: true }));
  for (let minute = 0; minute < 26 * 60; minute++) {
    vi.setSystemTime(start + minute * 60000);
    await renewTelemetryIfNeeded(renew); await action(); flushTelemetry(); await Promise.resolve();
  }
  expect(renew).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(1560);
  const batches = send.mock.calls.map(call => JSON.parse(call[1].body));
  expect(batches.at(-1).ticket).toBe("renewed-ticket");
  expect(new Set(batches.flatMap(batch => batch.events.map((event: TelemetryEvent) => event.session))).size).toBe(1);
  expect(batches.every(batch => batch.events.length === 2)).toBe(true);
});
it("bounds failed renewal to hourly attempts and ignores a late result after logout", async () => {
  vi.useFakeTimers(); const start = Date.now();
  configureTelemetry({ ...config, expiresAt: start + 3600000 });
  const fail = vi.fn().mockRejectedValue(new Error("offline"));
  await renewTelemetryIfNeeded(fail); await renewTelemetryIfNeeded(fail);
  expect(fail).toHaveBeenCalledTimes(1);
  vi.setSystemTime(start + 3600000); await renewTelemetryIfNeeded(fail);
  expect(fail).toHaveBeenCalledTimes(2);
  vi.setSystemTime(start + 2 * 3600000);
  let resolve!: (value: Bootstrap) => void;
  const pending = renewTelemetryIfNeeded(() => new Promise(done => { resolve = done; }));
  resetTelemetryIdentity(); resolve({ ...config, expiresAt: Date.now() + 86400000 }); await pending;
  const another = vi.fn(); await renewTelemetryIfNeeded(another);
  expect(another).not.toHaveBeenCalled();
});
it("renews through an abortable same-origin fetch outside the Server Action queue", async () => {
  configureTelemetry({ ...config, expiresAt: Date.now() + 3600000 });
  const send = vi.fn().mockResolvedValue(Response.json({ ...config, ticket: "renewed", expiresAt: Date.now() + 86400000 }));
  vi.stubGlobal("fetch", send); await renewTelemetryIfNeeded();
  expect(send).toHaveBeenCalledExactlyOnceWith("/api/product-telemetry", expect.objectContaining({
    method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: expect.any(AbortSignal),
  }));
  expect(send.mock.calls[0][1]).not.toHaveProperty("body");
});

it("binds the default browser fetch receiver before storing it on the queue", async () => {
  const send = vi.fn(function (this: unknown) {
    if (this !== globalThis) throw new TypeError("Illegal invocation");
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  vi.stubGlobal("fetch", send);
  const q = new TelemetryQueue(config);
  q.add({ id: crypto.randomUUID(), at: Date.now(), session: crypto.randomUUID(), route: "/", scene: "site", kind: "page" });
  await q.flush();
  expect(send).toHaveBeenCalledTimes(1);
  expect(q.metrics.failures).toBe(0);
});

it("projects numeric vitals, coalesces updates, and attributes late reports to their source route", async () => {
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", send); configureTelemetry(config);
  window.history.replaceState(null, "", "/2026-private/stats");
  setTelemetryScene("/2026-private", "major", crypto.randomUUID());
  const metric = { name: "LCP", id: "native-PRIVATE-id", value: 120.4,
    navigationURL: `${window.location.origin}/players/PRIVATE?q=SECRET`, navigationStartTime: performance.now() + 1,
    entries: [{ selector: "PRIVATE", text: "SECRET" }] };
  recordWebVital(metric); recordWebVital({ ...metric, value: 245.8 });
  recordWebVital({ ...metric, name: "CLS", value: 101 });
  recordWebVital({ ...metric, value: NaN });
  recordWebVital({ ...metric, navigationURL: "https://foreign.invalid/PRIVATE" });
  flushTelemetry(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  const sent = JSON.parse(send.mock.calls[0][1].body);
  expect(sent.events).toHaveLength(1);
  expect(sent.events[0]).toMatchObject({ kind: "performance", metricName: "LCP", durationMs: 246, route: "/players/[userId]", scene: "site" });
  expect(sent.events[0]).not.toHaveProperty("eventId");
  expect(JSON.stringify(sent)).not.toMatch(/PRIVATE|SECRET|native-|selector|entries|navigationURL/);
});

it("records committed router latency, replaces abandoned transitions and drops old-identity measurements", async () => {
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", send); configureTelemetry(config);
  let clock = performance.now() + 100;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  beginTelemetryNavigation("/players/abandoned", "push"); clock += 40;
  beginTelemetryNavigation("/stats?tab=players&q=PRIVATE", "traverse"); clock += 123;
  window.history.replaceState(null, "", "/stats?tab=players&q=PRIVATE"); recordPage();
  flushTelemetry(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(JSON.parse(send.mock.calls[0][1].body).events.find((event: TelemetryEvent) => event.kind === "performance")).toMatchObject({ metricName: "NAV_COMMIT", durationMs: 123, route: "/stats", navigation: "history" });
  beginTelemetryNavigation("/teams/PRIVATE", "push");
  const oldStart = clock; clock += 10;
  configureTelemetry({ ...config, identity: "new-account" });
  recordWebVital({ name: "LCP", id: "old-navigation", value: 200, navigationURL: window.location.href, navigationStartTime: oldStart });
  window.history.replaceState(null, "", "/teams/PRIVATE"); recordPage();
  flushTelemetry(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(JSON.parse(send.mock.calls[1][1].body).events.every((event: TelemetryEvent) => event.kind !== "performance")).toBe(true);
});


it("records coalesced CLS scores separately from millisecond durations", async () => {
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", send); configureTelemetry(config);
  const metric = { name: "CLS", id: "private-native-id", value: 0.07512, navigationURL: window.location.href, navigationStartTime: performance.now() + 10000 };
  recordWebVital(metric); recordWebVital({ ...metric, value: 0.12544 });
  flushTelemetry(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  const events = JSON.parse(send.mock.calls[0][1].body).events;
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ metricName: "CLS", score: 0.1254 });
  expect(events[0]).not.toHaveProperty("durationMs");
  expect(events[0].client).toHaveProperty("source");
  expect(JSON.stringify(events)).not.toContain("private-native-id");
});

it("keeps a Web Vital sample's session stable across the inactivity boundary", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", send); configureTelemetry(config);
  const metric = { name: "LCP", value: 1200, id: "native-sample", navigationURL: window.location.href, navigationStartTime: performance.now() };
  recordWebVital(metric); flushTelemetry(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  vi.setSystemTime(Date.now() + 31 * 60000);
  recordWebVital({ ...metric, value: 1800 }); flushTelemetry(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  const first = JSON.parse(send.mock.calls[0][1].body).events[0];
  const last = JSON.parse(send.mock.calls[1][1].body).events[0];
  expect(last.id).toBe(first.id);
  expect(last.session).toBe(first.session);
});

it("gates ready collection, deduplicates phases and rejects an old navigation token", async () => {
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", send); configureTelemetry(config);
  expect(captureTelemetryNavigation()).toBeNull();
  configureTelemetry({ ...config, measurementVersion: 1 });
  const token = captureTelemetryNavigation();
  recordContentReady(token, "statistics", "primary");
  recordContentReady(token, "statistics", "primary");
  window.history.replaceState(null, "", "/stats");
  recordContentReady(token, "statistics", "advanced");
  recordContentReady(captureTelemetryNavigation(), "statistics", "primary");
  flushTelemetry(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  const events = JSON.parse(send.mock.calls[0][1].body).events;
  expect(events).toHaveLength(2);
  expect(events.every((e: TelemetryEvent) => e.kind === "ready")).toBe(true);
  expect(events[0].measurement.navigationId).not.toBe(events[1].measurement.navigationId);
  expect(JSON.stringify(events)).not.toMatch(/native-sample/);
});

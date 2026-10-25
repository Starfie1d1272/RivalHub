import { afterEach, expect, it, vi } from "vitest";
import { beginTelemetryDemand, recordDemandReady, exposeTelemetryTask, recordTaskValidation, beginTelemetryTask, completeTelemetryTask, beginTelemetryNavigation, captureTelemetryNavigation, recordContentReady, restoreTelemetryPage, recordTelemetryVisibility, recordClientError, recordClientBoundaryError, configureTelemetry, flushTelemetry, observeAction, recordPage, recordWebVital, renewTelemetryIfNeeded, resetTelemetryIdentity, setTelemetryScene } from "@/lib/telemetry/client";
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

it("shares one session between first vitals and page, rotates once after idle, and preserves old sample updates", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", send); configureTelemetry(config);
  const source = { navigationURL: window.location.href, navigationStartTime: performance.now() };
  recordWebVital({ ...source, name: "LCP", value: 1000, id: "first" }); recordPage();
  flushTelemetry(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  const first = JSON.parse(send.mock.calls[0][1].body).events;
  expect(first[0].session).toBe(first[1].session);
  vi.setSystemTime(Date.now() + 31 * 60000);
  recordWebVital({ ...source, name: "LCP", value: 1200, id: "new" });
  recordWebVital({ ...source, name: "INP", value: 50, id: "new-inp" });
  flushTelemetry(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  const next = JSON.parse(send.mock.calls[1][1].body).events;
  expect(next[0].session).toBe(next[1].session);
  expect(next[0].session).not.toBe(first[0].session);
  await new Promise(resolve => setTimeout(resolve, 0));
  vi.setSystemTime(Date.now() + 1000);
  recordWebVital({ ...source, name: "LCP", value: 1300, id: "first" });
  flushTelemetry(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
  expect(JSON.parse(send.mock.calls[2][1].body).events[0].session).toBe(first[0].session);
});

it("keeps an operation completion on its starting route and navigation after a later page commits", async () => {
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", send); window.history.replaceState(null, "", "/stats");
  configureTelemetry({ ...config, measurementVersion: 1 }); recordPage();
  let resolve!: (value: { success: true }) => void;
  const pending = observeAction("captains.castVote", () => new Promise<{ success: true }>(r => { resolve = r; }))();
  beginTelemetryNavigation("/teams", "push"); window.history.replaceState(null, "", "/teams"); recordPage();
  resolve({ success: true }); await pending;
  flushTelemetry(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  const events = JSON.parse(send.mock.calls[0][1].body).events as TelemetryEvent[];
  const action = events.filter(e => e.kind === "operation");
  expect(action).toHaveLength(2);
  expect(action[0].route).toBe("/stats"); expect(action[1].route).toBe("/stats");
  expect(action[0].measurement?.navigationId).toBe(action[1].measurement?.navigationId);
  expect(action[1].measurement?.navigationId).not.toBe(events.find(e => e.route === "/teams")?.measurement?.navigationId);
});

it("rotates navigation on BFCache restore and marks a hidden/visible lifecycle without resetting ready", async () => {
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", send); configureTelemetry({ ...config, measurementVersion: 1 });
  const old = captureTelemetryNavigation();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); recordTelemetryVisibility();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); recordTelemetryVisibility();
  recordContentReady(old, "statistics", "primary");
  restoreTelemetryPage(new PageTransitionEvent("pageshow", { persisted: true }));
  recordContentReady(old, "statistics", "advanced");
  recordContentReady(captureTelemetryNavigation(), "statistics", "primary");
  flushTelemetry(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  const events = JSON.parse(send.mock.calls[0][1].body).events as TelemetryEvent[];
  expect(events[0].measurement?.lifecycle?.resumed).toBe(true);
  expect(events.filter(e => e.kind === "ready")).toHaveLength(2);
  expect(events.at(-1)?.measurement?.lifecycle?.navigationType).toBe("bfcache");
  expect(events.at(-1)?.measurement?.navigationId).not.toBe(old);
});

it("only fingerprints controlled Next chunk frames, never arbitrary error text or getter stacks", async () => {
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", send); configureTelemetry({ ...config, measurementVersion: 1 });
  const error = new TypeError("PRIVATE MESSAGE");
  error.stack = "PRIVATE MESSAGE\n at x (https://private.invalid/_next/static/chunks/app-fixture.js:12:34)";
  recordClientError(new ErrorEvent("error", { error, filename: "https://private.invalid/_next/static/chunks/app-fixture.js", lineno: 12, colno: 34 }));
  const getter = vi.fn(() => { throw new Error("PRIVATE GETTER"); });
  recordClientError(new ErrorEvent("error", { error: Object.defineProperty({}, "stack", { get: getter }) }));
  flushTelemetry(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  const events = JSON.parse(send.mock.calls[0][1].body).events as TelemetryEvent[];
  expect(events[0].clientError?.fingerprint).toMatch(/^s1:[0-9a-f]{16}$/);
  expect(events[1].clientError?.fingerprint).toBeUndefined();
  expect(getter).not.toHaveBeenCalled();
  expect(JSON.stringify(events)).not.toMatch(/PRIVATE|private.invalid|app-fixture|12:34/);
});

it("keeps native prerender lifecycle and source route on a late metric instead of copying current SPA navigation", async () => {
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", send); configureTelemetry({ ...config, measurementVersion: 1 });
  const start = performance.now();
  const entries = vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ activationStart: 123 }] as unknown as PerformanceEntryList);
  try {
    window.history.replaceState(null, "", "/teams"); recordPage();
    recordWebVital({ name: "FCP", id: "late-private-native-id", value: 2344987, navigationURL: `${window.location.origin}/stats`, navigationStartTime: start, navigationType: "prerender" });
    flushTelemetry(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const events = JSON.parse(send.mock.calls[0][1].body).events as TelemetryEvent[];
    expect(events[1]).toMatchObject({ route: "/stats", durationMs: 2344987, measurement: { lifecycle: { navigationType: "prerender", activationMs: 123 } } });
    expect(events[1].measurement?.navigationId).not.toBe(events[0].measurement?.navigationId);
    expect(JSON.stringify(events)).not.toContain("late-private-native-id");
  } finally { entries.mockRestore(); }
});

it("refreshes activation timing after prerender activation without replacing the navigation token", async () => {
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", send); configureTelemetry({ ...config, measurementVersion: 1 });
  const entries = vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ activationStart: 0 }] as unknown as PerformanceEntryList);
  Object.defineProperty(document, "prerendering", { configurable: true, value: true });
  try {
    const token = captureTelemetryNavigation();
    Object.defineProperty(document, "prerendering", { configurable: true, value: false });
    entries.mockReturnValue([{ activationStart: 321 }] as unknown as PerformanceEntryList);
    recordTelemetryVisibility(); recordContentReady(token, "public", "primary");
    flushTelemetry(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const event = JSON.parse(send.mock.calls[0][1].body).events[0] as TelemetryEvent;
    expect(event.measurement).toMatchObject({ navigationId: token, lifecycle: { navigationType: "prerender", activationMs: 321 } });
  } finally { entries.mockRestore(); Object.defineProperty(document, "prerendering", { configurable: true, value: false }); }
});

it("lets a local boundary provide its error through the same privacy projection", async () => {
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", send); configureTelemetry({ ...config, measurementVersion: 1 });
  recordClientBoundaryError({ name: "TypeError", message: "PRIVATE", stack: "TypeError: PRIVATE\n at x (https://private.invalid/_next/static/chunks/boundary-fixture.js:10:20)" });
  flushTelemetry(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  const events = JSON.parse(send.mock.calls[0][1].body).events as TelemetryEvent[];
  expect(events[0].clientError).toMatchObject({ source: "boundary", category: "TypeError" });
  expect(events[0].clientError?.fingerprint).toMatch(/^s1:[0-9a-f]{16}$/);
  expect(JSON.stringify(events)).not.toMatch(/PRIVATE|private.invalid|boundary-fixture/);
});

it("reports current visibility on completion and native metric updates while preserving their original correlation", async () => {
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", send); configureTelemetry({ ...config, measurementVersion: 1 });
  const previous = Object.getOwnPropertyDescriptor(document, "visibilityState");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  try {
    let finish!: (value: { success: true }) => void;
    const pending = observeAction("captains.castVote", () => new Promise<{ success: true }>(resolve => { finish = resolve; }))();
    const metric = { name: "LCP", id: "same-sample", value: 1000, navigationURL: window.location.href, navigationStartTime: performance.now(), navigationType: "navigate" };
    recordWebVital(metric);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    finish({ success: true }); await pending;
    recordWebVital({ ...metric, value: 1500 });
    flushTelemetry(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const events = JSON.parse(send.mock.calls[0][1].body).events as TelemetryEvent[];
    const operation = events.filter(event => event.kind === "operation");
    expect(operation[0].measurement?.visibility).toBe("visible");
    expect(operation[1].measurement?.visibility).toBe("hidden");
    expect(operation[1].measurement?.navigationId).toBe(operation[0].measurement?.navigationId);
    expect(events.find(event => event.kind === "performance")?.measurement?.visibility).toBe("hidden");
  } finally {
    if (previous) Object.defineProperty(document, "visibilityState", previous);
    else Reflect.deleteProperty(document, "visibilityState");
  }
});


it("gates task collection, clears attempts on disable and keeps identities separate", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", send); configureTelemetry(config);
  expect(beginTelemetryTask("profile", "PRIVATE")).toBeNull();
  configureTelemetry({ ...config, measurementVersion: 1 });
  const old = beginTelemetryTask("profile", "PRIVATE");
  configureTelemetry({ ...config, identity: "second", measurementVersion: 1 });
  completeTelemetryTask("profile", old);
  const current = beginTelemetryTask("profile", "SECRET");
  await observeAction("account.updateProfile", async () => ({ success: true }))();
  completeTelemetryTask("profile", old);
  completeTelemetryTask("profile", current);
  flushTelemetry(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  const events = JSON.parse(send.mock.calls[0][1].body).events as TelemetryEvent[];
  expect(events.filter(e => e.kind === "task").map(e => e.task?.phase)).toEqual(["start", "complete"]);
  expect(events.filter(e => e.kind === "operation").every(e => e.task?.attemptId === current)).toBe(true);
  expect(JSON.stringify(events)).not.toMatch(/PRIVATE|SECRET/);
  vi.setSystemTime(Date.now() + 1001);
  beginTelemetryTask("profile");
  configureTelemetry({ ...config, identity: "second" });
  completeTelemetryTask("profile");
  flushTelemetry(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(JSON.parse(send.mock.calls[1][1].body).events.filter((e: TelemetryEvent) => e.task?.phase === "complete")).toHaveLength(0);
});


it("deduplicates eligible exposure separately from attempts and only reports fixed validation categories", async () => {
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", send); configureTelemetry({ ...config, measurementVersion: 1 });
  exposeTelemetryTask("registration", "PRIVATE"); exposeTelemetryTask("registration", "PRIVATE");
  const token = beginTelemetryTask("registration", "PRIVATE");
  recordTaskValidation("registration", "form_invalid", token);
  flushTelemetry(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  const events = JSON.parse(send.mock.calls[0][1].body).events as TelemetryEvent[];
  expect(events.filter(e => e.task?.phase === "exposure")).toHaveLength(1);
  expect(events.filter(e => e.task?.phase === "start")).toHaveLength(1);
  expect(events.find(e => e.task?.validationReason)?.task).toMatchObject({ validationReason: "form_invalid", attemptId: token });
  expect(JSON.stringify(events)).not.toContain("PRIVATE");
});

it("flushes a login receipt with its anonymous attempt before resetting and ignores old identity results", async () => {
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal("fetch", send);
  configureTelemetry({ ...config, identity: "anonymous", measurementVersion: 1 });
  const token = beginTelemetryTask("login", "", "submit");
  await observeAction("auth.loginWithPassword", async () => ({ success: true }))();
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  const events: TelemetryEvent[] = JSON.parse(send.mock.calls[0][1].body).events;
  expect(events.filter(e => e.kind === "task").map(e => e.task?.phase)).toEqual(["start", "complete"]);
  expect(events.at(-1)?.task).toMatchObject({ attemptId: token, step: "confirm" });
  configureTelemetry({ ...config, identity: "account-a", measurementVersion: 1 });
  let resolve!: (v: { success: true }) => void;
  const pending = observeAction("auth.loginWithPassword", () => new Promise<{ success: true }>(done => { resolve = done; }))();
  configureTelemetry({ ...config, identity: "account-b", measurementVersion: 1 });
  const current = beginTelemetryTask("profile"); resolve({ success: true }); await pending;
  completeTelemetryTask("profile", current); flushTelemetry();
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(JSON.parse(send.mock.calls[1][1].body).events.filter((e: TelemetryEvent) => e.task?.phase === "complete")).toHaveLength(1);
});
it("discards a detached receipt when privacy closes collection", async () => {
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal("fetch", send);
  configureTelemetry({ ...config, measurementVersion: 1 }); const token = beginTelemetryTask("profile");
  vi.stubGlobal("navigator", { ...navigator, doNotTrack: "1" });
  completeTelemetryTask("profile", token); flushTelemetry(); expect(send).not.toHaveBeenCalled();
});


it("captures demand start independently, preserves navigation ready, and withholds unsupported basis", async () => {
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal("fetch", send);
  configureTelemetry({ ...config, measurementVersion: 1 });
  const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  const navigation = captureTelemetryNavigation(); clock.mockReturnValue(300000);
  const token = beginTelemetryDemand("player");
  expect(token).toEqual({ navigationId: navigation, module: "player", started: 300000 });
  clock.mockReturnValue(300450); recordDemandReady(token, "advanced"); recordDemandReady(token, "advanced");
  flushTelemetry(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  const ready = JSON.parse(send.mock.calls[0][1].body).events.filter((e: TelemetryEvent) => e.kind === "ready");
  expect(ready).toHaveLength(1); expect(ready[0]).toMatchObject({ durationMs: 300450, ready: { module: "player", phase: "advanced" } });
  expect(ready[0].ready).not.toHaveProperty("basis");
  const old = beginTelemetryDemand("team"); configureTelemetry({ ...config, identity: "another", measurementVersion: 1 });
  recordDemandReady(old, "advanced"); flushTelemetry(); expect(send).toHaveBeenCalledTimes(1);
  clock.mockRestore();
});

it("only shares native navigation identity with explicit matching source, kind and monotonic start", async () => {
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal("fetch", send);
  configureTelemetry({ ...config, measurementVersion: 1 });
  const start = performance.now() + 100;
  vi.spyOn(performance, "now").mockReturnValue(start);
  beginTelemetryNavigation(`${window.location.origin}/teams?view=all`, "navigate");
  window.history.replaceState(null, "", "/teams?view=all");
  const token = captureTelemetryNavigation();
  recordContentReady(token, "team", "primary");
  recordWebVital({ name: "LCP", id: "matched", value: 900, navigationURL: window.location.href, navigationStartTime: start, navigationType: "soft-navigation" });
  recordWebVital({ name: "FCP", id: "unmatched", value: 500, navigationURL: window.location.href, navigationStartTime: start - 1, navigationType: "soft-navigation" });
  flushTelemetry(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  const events: TelemetryEvent[] = JSON.parse(send.mock.calls[0][1].body).events;
  expect(events.find(e => e.metricName === "LCP")?.measurement?.navigationId).toBe(token);
  expect(events.find(e => e.metricName === "FCP")?.measurement?.navigationId).not.toBe(token);
});

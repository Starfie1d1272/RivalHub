import { afterEach, expect, it, vi } from "vitest";
import { configureTelemetry, flushTelemetry, observeAction, recordPage, resetTelemetryIdentity } from "@/lib/telemetry/client";
import { TelemetryQueue } from "@/lib/telemetry/queue";
import type { Bootstrap, TelemetryEvent } from "@/lib/telemetry/protocol";

const config: Bootstrap = { endpoint: "https://receiver.invalid/v1/batches", ticket: "transport-only", identity: "fixture", expiresAt: Date.now() + 86400000 };
afterEach(() => { resetTelemetryIdentity(); vi.unstubAllGlobals(); vi.useRealTimers(); });
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

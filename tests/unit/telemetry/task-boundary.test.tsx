import { act, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useTelemetryTask } from "@/components/telemetry/TaskBoundary";
import { configureTelemetry, flushTelemetry, resetTelemetryIdentity } from "@/lib/telemetry/client";
import type { TelemetryEvent } from "@/lib/telemetry/protocol";

const config = { endpoint: "https://receiver.invalid/v1/batches", ticket: "fixture", identity: "anonymous", expiresAt: Date.now() + 86400000, measurementVersion: 1 as const };
afterEach(() => { resetTelemetryIdentity(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("records a receipt synchronously across unmount, retains detached pending work, and isolates scopes", async () => {
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal("fetch", send); configureTelemetry(config);
  const handles: ReturnType<typeof useTelemetryTask>[] = [];
  function Entry({ scope }: { scope: string }) { handles.push(useTelemetryTask("registration", scope)); return null; }
  const view = render(<Entry scope="first-private" />); const first = handles.at(-1)!;
  const a = first.begin("submit"); view.rerender(<Entry scope="second-private" />);
  const second = handles.at(-1)!; const b = second.begin("submit");
  act(() => { first.complete(a); view.unmount(); });
  second.complete(b); second.complete(b);
  flushTelemetry(); await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  const events: TelemetryEvent[] = JSON.parse(send.mock.calls[0][1].body).events;
  const receipts = events.filter(e => e.task?.phase === "complete");
  expect(receipts.map(e => e.task?.attemptId)).toEqual([a, b]);
  expect(receipts.every(e => e.task?.step === "confirm")).toBe(true);
  expect(events.some(e => e.task?.step === "result")).toBe(false);
  expect(JSON.stringify(events)).not.toContain("private");
});
it("does not complete unfinished work on unmount", async () => {
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal("fetch", send); configureTelemetry(config);
  let tracker!: ReturnType<typeof useTelemetryTask>;
  function Entry() { tracker = useTelemetryTask("registration"); return null; }
  const view = render(<Entry />); tracker.begin(); view.unmount(); flushTelemetry();
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(JSON.parse(send.mock.calls[0][1].body).events.some((e: TelemetryEvent) => e.task?.phase === "complete")).toBe(false);
});

it("retains same-token presentation after completion but rejects presentation after cancel or identity change", async () => {
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal("fetch", send); configureTelemetry(config);
  let tracker!: ReturnType<typeof useTelemetryTask>;
  function Entry() { tracker = useTelemetryTask("registration"); return null; }
  const view = render(<Entry />);
  const a = tracker.begin("submit"); tracker.complete(a); tracker.step("result", a); tracker.step("result", a);
  const b = tracker.begin("submit"); tracker.cancel(); tracker.step("result", b); tracker.complete(b);
  configureTelemetry({ ...config, identity: "another-account" }); tracker.step("result", a); flushTelemetry();
  expect(send).not.toHaveBeenCalled(); // Old queue was discarded without attributing its events to the new identity.
  const c = tracker.begin("submit"); tracker.complete(c); tracker.step("result", c); flushTelemetry();
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  const events: TelemetryEvent[] = JSON.parse(send.mock.calls[0][1].body).events;
  expect(events.filter(e => e.task?.phase === "complete")).toHaveLength(1);
  expect(events.filter(e => e.task?.step === "result")).toHaveLength(1);
  expect(events.every(e => e.task?.attemptId === c)).toBe(true); view.unmount();
});

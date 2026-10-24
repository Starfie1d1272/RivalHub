import { afterEach, expect, it, vi } from "vitest";
import { fetchVetoRoom, vetoClockUpperBound } from "@/lib/matches/veto-room/client";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("uses the whole monotonic request duration as an uncertainty bound, including asymmetric delay", async () => {
  vi.useFakeTimers();
  const serverNow = "2026-10-24T12:00:00.000Z";
  const room = { session: { serverNow } };
  vi.stubGlobal("fetch", vi.fn(async () => {
    await new Promise(resolve => setTimeout(resolve, 800));
    return { json: async () => { await new Promise(resolve => setTimeout(resolve, 200)); return { success: true, data: room }; } };
  }));
  const response = fetchVetoRoom("fixture", new AbortController().signal);
  // A wall-clock adjustment cannot extend the displayed monotonic deadline.
  vi.setSystemTime("2030-01-01T00:00:00Z");
  await vi.advanceTimersByTimeAsync(1000);
  const result = await response;
  expect(result.success).toBe(true);
  if (result.success) expect(vetoClockUpperBound(result.data)).toBe(new Date(serverNow).getTime() + 1000);
});

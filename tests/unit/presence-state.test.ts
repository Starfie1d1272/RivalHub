import { describe, expect, it, vi } from "vitest";
import { PresenceState } from "@/lib/presence/state";

describe("process presence", () => {
  it("deduplicates accounts across tabs, expires visibility and preserves five-minute activity checkpoints", async () => {
    const state = new PresenceState();
    const persist = vi.fn(async () => true);
    await state.touch("one", 0, persist);
    await state.touch("one", 60_000, persist);
    await state.touch("two", 60_000, persist);
    expect(state.count(119_999)).toBe(2);
    expect(state.count(180_000)).toBe(0);
    expect(persist).toHaveBeenCalledTimes(2);
    await state.touch("one", 300_000, persist);
    expect(persist).toHaveBeenCalledTimes(3);
    expect(state.count(300_000)).toBe(1);
  });

  it("retries a checkpoint suppressed by a recent database write after process restart", async () => {
    const state = new PresenceState();
    const persist = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await state.touch("one", 0, persist);
    await state.touch("one", 60_000, persist);
    expect(persist).toHaveBeenCalledTimes(2);
    await state.touch("one", 120_000, persist);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("shares an in-flight checkpoint and retries failed persistence", async () => {
    const state = new PresenceState();
    let reject!: (error: Error) => void;
    const persist = vi.fn(() => new Promise<boolean>((_, r) => { reject = r; }));
    const first = state.touch("one", 0, persist);
    const second = state.touch("one", 1, persist);
    expect(persist).toHaveBeenCalledTimes(1);
    reject(new Error("unavailable"));
    await expect(first).rejects.toThrow("unavailable");
    await expect(second).rejects.toThrow("unavailable");
    const retry = vi.fn(async () => true);
    await state.touch("one", 2, retry);
    expect(retry).toHaveBeenCalledOnce();
  });
});

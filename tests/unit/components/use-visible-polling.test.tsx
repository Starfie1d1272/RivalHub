import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVisiblePolling } from "@/components/use-visible-polling";

describe("visible polling", () => {
  const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
  function setVisibility(value: "hidden" | "visible") {
    Object.defineProperty(document, "visibilityState", { configurable: true, value });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
  });
  afterEach(() => {
    vi.useRealTimers();
    if (originalVisibility) Object.defineProperty(document, "visibilityState", originalVisibility);
    else Reflect.deleteProperty(document, "visibilityState");
  });

  it("stops all hidden-tab reads and immediately resynchronizes when visible", async () => {
    const poll = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useVisiblePolling(poll, 2_000));
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(poll).toHaveBeenCalledTimes(1);
    act(() => setVisibility("hidden"));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(poll).toHaveBeenCalledTimes(1);
    await act(async () => setVisibility("visible"));
    expect(poll).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("does not overlap slow requests, including visibility recovery", async () => {
    let finish!: () => void;
    const poll = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { unmount } = renderHook(() => useVisiblePolling(poll, 2_000));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(poll).toHaveBeenCalledTimes(1);
    act(() => { setVisibility("hidden"); setVisibility("visible"); });
    expect(poll).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(poll).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => finish());
  });

  it("uses the latest read callback without restarting its clock, and stops terminal polling", async () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ poll, interval }: { poll: () => void; interval: number | null }) => useVisiblePolling(poll, interval),
      { initialProps: { poll: first, interval: 10_000 as number | null } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    rerender({ poll: latest, interval: 10_000 });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    rerender({ poll: latest, interval: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await act(async () => { setVisibility("hidden"); setVisibility("visible"); });
    expect(latest).toHaveBeenCalledTimes(1);
    unmount();
  });
});

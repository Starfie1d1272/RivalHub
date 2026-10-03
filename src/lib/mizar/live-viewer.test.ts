import { afterEach, describe, expect, it, vi } from "vitest";
import type { createLiveViewerClient } from "@/lib/auth/supabase";
import { connectLiveViewer, type ViewerEnvironment } from "./live-viewer";
import type { LiveViewerState } from "./live-viewer-state";
import { projectPublicLive } from "./live-projection";
import { parseLiveSnapshotV1 } from "./protocol";
import fixture from "../../../tests/fixtures/contracts/mizar-live-real-derived.json";

function setup() {
  vi.useFakeTimers();
  const clients: { status: (value: string) => void; deliver: (input: { payload: unknown }) => void; removeAllChannels: ReturnType<typeof vi.fn>; realtime: { disconnect: ReturnType<typeof vi.fn> }; channel: ReturnType<typeof vi.fn> }[] = [];
  let resume = () => {};
  let visible = true;
  const removeListener = vi.fn();
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ token: "viewer", topic: "server-owned-topic", expiresAt: Date.now() + 300000 })));
  const factory = vi.fn(() => {
    const client = { status: vi.fn<(value: string) => void>(), deliver: vi.fn<(input: { payload: unknown }) => void>(), removeAllChannels: vi.fn(async () => []), realtime: { disconnect: vi.fn() }, channel: vi.fn() };
    const channel = { on: vi.fn((_kind, _filter, handler) => { client.deliver = handler; return channel; }), subscribe: vi.fn(handler => { client.status = handler; return channel; }) };
    client.channel.mockReturnValue(channel);
    clients.push(client);
    return client;
  });
  const environment: ViewerEnvironment = {
    url: "https://local.invalid", key: "publishable", fetch: fetcher as typeof fetch,
    createClient: factory as unknown as typeof createLiveViewerClient, now: () => performance.now(),
    visible: () => visible, onResume: callback => { resume = callback; return removeListener; },
  };
  const states: LiveViewerState[] = [];
  const stop = connectLiveViewer(fixture.snapshot.matchId, state => states.push(state), environment);
  return { clients, states, stop, factory, fetcher, removeListener, hide: () => { visible = false; resume(); }, show: () => { visible = true; resume(); } };
}
afterEach(() => vi.useRealTimers());
describe("private viewer lifecycle", () => {
  it("subscribes privately with the receive token, renews and disposes every client", async () => {
    const h = setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.clients[0].channel).toHaveBeenCalledWith("server-owned-topic", { config: { private: true, broadcast: { self: false } } });
    const options = h.factory.mock.calls[0] as unknown as [string, string, () => Promise<string>];
    expect(await options[2]()).toBe("viewer");
    h.clients[0].status("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(270000);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(h.clients[0].removeAllChannels).toHaveBeenCalledOnce();
    h.stop();
    expect(h.clients[1].realtime.disconnect).toHaveBeenCalledOnce();
    expect(h.removeListener).toHaveBeenCalledOnce();
  });
  it("reconnects without replay and ignores callbacks from a disposed match connection", async () => {
    const h = setup(); await vi.advanceTimersByTimeAsync(0);
    const wire = parseLiveSnapshotV1(fixture.snapshot);
    const payload = projectPublicLive(wire, 1, wire.producedAt);
    h.clients[0].status("SUBSCRIBED"); h.clients[0].deliver({ payload });
    expect(h.states.at(-1)?.snapshot).toEqual(payload);
    h.clients[0].status("CHANNEL_ERROR");
    expect(h.states.at(-1)?.snapshot).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    h.clients[0].deliver({ payload });
    h.clients[1].deliver({ payload });
    expect(h.states.at(-1)?.snapshot).toBeNull();
    h.stop();
    const count = h.states.length;
    h.clients[1].deliver({ payload });
    expect(h.states).toHaveLength(count);
  });
  it("disconnects while hidden and rejoins on foreground recovery", async () => {
    const h = setup(); await vi.advanceTimersByTimeAsync(0);
    h.hide(); expect(h.clients[0].realtime.disconnect).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(300000);
    expect(h.fetcher).toHaveBeenCalledOnce();
    h.show(); await vi.advanceTimersByTimeAsync(0);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    h.stop();
  });
  it("retries token failure with bounded backoff and cancels retry on disposal", async () => {
    const h = setup(); await vi.advanceTimersByTimeAsync(0);
    h.fetcher.mockRejectedValue(new Error("network"));
    h.clients[0].status("CHANNEL_ERROR");
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    h.stop(); await vi.advanceTimersByTimeAsync(60000);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
  });
});

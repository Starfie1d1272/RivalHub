import { afterEach, describe, expect, it, vi } from "vitest";
import type { createLiveViewerClient } from "@/lib/auth/supabase";
import { connectLiveViewer, type ViewerEnvironment } from "./live-viewer";
import { createLiveViewerSubscriptions } from "./live-viewer-subscriptions";
import { liveFreshness } from "./live-viewer-state";
import type { LiveViewerState } from "./live-viewer-state";
import { projectPublicLive } from "./live-projection";
import { parseLiveSnapshotV1 } from "./protocol";
import fixture from "../../../tests/fixtures/contracts/mizar-live-real-derived.json";
import { createPreviousLiveViewStore, type PreviousLiveViewStore } from "./live-previous-view";

function setup(shared = false, options?: { previousViews: PreviousLiveViewStore; cacheContext?: unknown; matchId: string }) {
  vi.useFakeTimers();
  const clients: { status: (value: string) => void; deliver: (input: { payload: unknown }) => void; removeAllChannels: ReturnType<typeof vi.fn>; realtime: { disconnect: ReturnType<typeof vi.fn>; setAuth: ReturnType<typeof vi.fn> }; channel: ReturnType<typeof vi.fn> }[] = [];
  let resume = () => {};
  let identityChange = () => {};
  let visible = true;
  const removeListener = vi.fn();
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ token: "viewer", topic: "server-owned-topic", expiresAt: Date.now() + 300000, cacheContext: options?.cacheContext })));
  const factory = vi.fn(() => {
    const client = { status: vi.fn<(value: string) => void>(), deliver: vi.fn<(input: { payload: unknown }) => void>(), removeAllChannels: vi.fn(async () => []), realtime: { disconnect: vi.fn(), setAuth: vi.fn(async () => {}) }, channel: vi.fn() };
    const channel = { on: vi.fn((_kind, _filter, handler) => { client.deliver = handler; return channel; }), subscribe: vi.fn(handler => { client.status = handler; return channel; }) };
    client.channel.mockReturnValue(channel);
    clients.push(client);
    return client;
  });
  const environment: ViewerEnvironment = {
    url: "https://local.invalid", key: "publishable", fetch: fetcher as typeof fetch,
    createClient: factory as unknown as typeof createLiveViewerClient, now: () => performance.now(),
    visible: () => visible, onResume: callback => { resume = callback; return removeListener; },
    previousViews: options?.previousViews, onIdentityChange: callback => { identityChange = callback; return () => {}; },
  };
  const states: LiveViewerState[] = [];
  const subscribe = createLiveViewerSubscriptions(environment);
  const matchId = options?.matchId ?? fixture.snapshot.matchId;
  const stop = shared ? subscribe(matchId, state => states.push(state)) : connectLiveViewer(matchId, state => states.push(state), environment);
  return { clients, states, stop, subscribe, factory, fetcher, removeListener, identityChange: () => identityChange(), hide: () => { visible = false; resume(); }, show: () => { visible = true; resume(); } };
}
afterEach(() => vi.useRealTimers());
describe("previous view is never a LIVE baseline", () => {
  function cached() {
    const frame = projectPublicLive(parseLiveSnapshotV1(fixture.snapshot), 1, fixture.snapshot.producedAt);
    frame.matchId = "40000000-0000-4000-8000-000000000001";
    frame.map.mapId = "40000000-0000-4000-8000-000000000002";
    const context = { schemaVersion: "rivalhub.previous-live.v1", seasonId: "40000000-0000-4000-8000-000000000003", matchId: frame.matchId,
      revision: "a".repeat(64), checkedAt: Date.parse(frame.receivedAt),
      boundary: { authorityRevision: 1, generation: frame.delivery.generation, epoch: frame.delivery.epoch, mapId: frame.map.mapId } };
    const entries = new Map<string, string>();
    const previousViews = createPreviousLiveViewStore({ getItem: key => entries.get(key) ?? null, setItem: (key, value) => { entries.set(key, value); }, removeItem: key => { entries.delete(key); } }, "local");
    previousViews.authorize(context, frame.matchId, 0, 0); previousViews.remember(frame, 0);
    return { frame, context, entries, previousViews };
  }
  it("restores only after proof, leaves live freshness/watermark empty, and lets the first valid new delivery win", async () => {
    const cache = cached();
    const h = setup(false, { ...cache, cacheContext: cache.context, matchId: cache.frame.matchId });
    expect(h.states.at(-1)?.previousView).toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.states.at(-1)?.previousView?.snapshot.receivedAt).toBe(cache.frame.receivedAt);
    expect(h.states.at(-1)?.snapshot).toBeNull(); expect(h.states.at(-1)?.watermark).toBeNull();
    expect(liveFreshness(h.states.at(-1)!, performance.now())).toBe("unavailable");
    h.clients[0].status("SUBSCRIBED"); h.clients[0].deliver({ payload: cache.frame });
    expect(h.states.at(-1)?.snapshot).toEqual(cache.frame);
    expect(h.states.at(-1)?.acceptedFrames).toBe(1);
    h.identityChange();
    expect(cache.entries.size).toBe(0); expect(h.states.at(-1)?.previousView).toBeNull();
    h.stop();
  });
  it("keeps a recorded view on transport loss, then purges it on a revoked public scope", async () => {
    const cache = cached();
    const h = setup(false, { ...cache, cacheContext: cache.context, matchId: cache.frame.matchId });
    await vi.advanceTimersByTimeAsync(0);
    h.fetcher.mockResolvedValue(new Response("unavailable", { status: 404 }));
    h.clients[0].status("CHANNEL_ERROR");
    expect(h.states.at(-1)?.previousView).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.states.at(-1)?.previousView).toBeNull(); expect(cache.entries.size).toBe(0);
    h.stop();
  });
});
describe("private viewer lifecycle", () => {
  it("subscribes privately with the receive token, renews and disposes every client", async () => {
    const h = setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.clients[0].realtime.setAuth).toHaveBeenCalledWith("viewer");
    expect(h.clients[0].channel).toHaveBeenCalledWith("server-owned-topic", { config: { private: true, broadcast: { self: false } } });
    const options = h.factory.mock.calls[0] as unknown as [string, string, () => Promise<string>];
    expect(await options[2]()).toBe("viewer");
    h.clients[0].status("SUBSCRIBED");
    expect(h.states.at(-1)?.connection).toBe("subscribed");
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
    expect(h.states.at(-1)?.connection).toBe("unavailable");
    await vi.advanceTimersByTimeAsync(1000);
    h.clients[0].deliver({ payload });
    h.clients[1].status("SUBSCRIBED");
    h.clients[1].deliver({ payload });
    expect(h.states.at(-1)?.snapshot).toBeNull();
    expect(h.states.at(-1)?.connection).toBe("subscribed");
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

describe("browser-local active receiver reuse", () => {
  const frame = () => {
    const wire = parseLiveSnapshotV1(fixture.snapshot);
    return projectPublicLive(wire, 1, wire.producedAt);
  };
  it("shares an in-flight token request and disposes only after the last consumer leaves", async () => {
    const h = setup(true);
    const states: LiveViewerState[] = [];
    const stop = h.subscribe(fixture.snapshot.matchId, state => states.push(state));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetcher).toHaveBeenCalledOnce();
    h.clients[0].status("SUBSCRIBED"); h.clients[0].deliver({ payload: frame() });
    expect(states.at(-1)?.snapshot).not.toBeNull();
    h.stop(); h.stop();
    await vi.advanceTimersByTimeAsync(6000);
    expect(h.clients[0].realtime.disconnect).not.toHaveBeenCalled();
    stop(); await vi.advanceTimersByTimeAsync(5000);
    expect(h.clients[0].realtime.disconnect).toHaveBeenCalledOnce();
  });
  it("re-entry observes the running receiver, without resetting freshness or replaying an old heartbeat", async () => {
    const h = setup(true); await vi.advanceTimersByTimeAsync(0);
    h.clients[0].status("SUBSCRIBED"); h.clients[0].deliver({ payload: frame() });
    const receivedAt = h.states.at(-1)!.receivedAt;
    h.stop(); await vi.advanceTimersByTimeAsync(4000);
    const states: LiveViewerState[] = [];
    const stop = h.subscribe(fixture.snapshot.matchId, state => states.push(state));
    expect(h.fetcher).toHaveBeenCalledOnce();
    expect(states.at(-1)!.receivedAt).toBe(receivedAt);
    expect(liveFreshness(states.at(-1)!, performance.now())).toBe("stale");
    h.clients[0].deliver({ payload: frame() });
    expect(states.at(-1)!.receivedAt).toBe(receivedAt);
    await vi.advanceTimersByTimeAsync(6100);
    expect(liveFreshness(states.at(-1)!, performance.now())).toBe("unavailable");
    stop(); await vi.advanceTimersByTimeAsync(5000);
  });
  it("keeps receiving during the brief navigation gap, then removes all state after idle disposal", async () => {
    const h = setup(true); await vi.advanceTimersByTimeAsync(0);
    h.clients[0].status("SUBSCRIBED"); h.clients[0].deliver({ payload: frame() });
    h.stop(); await vi.advanceTimersByTimeAsync(1000);
    const next = frame(); next.delivery.sequence++;
    h.clients[0].deliver({ payload: next });
    const states: LiveViewerState[] = [];
    const stop = h.subscribe(fixture.snapshot.matchId, state => states.push(state));
    expect(states.at(-1)?.snapshot?.delivery.sequence).toBe(next.delivery.sequence);
    expect(liveFreshness(states.at(-1)!, performance.now())).toBe("fresh");
    stop(); await vi.advanceTimersByTimeAsync(5000);
    const final: LiveViewerState[] = [];
    const stopAgain = h.subscribe(fixture.snapshot.matchId, state => final.push(state));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(final.at(-1)?.snapshot).toBeNull();
    stopAgain(); await vi.advanceTimersByTimeAsync(5000);
  });
  it("isolates matches and receiver environments and clears frames on a real reconnect", async () => {
    const h = setup(true); await vi.advanceTimersByTimeAsync(0);
    h.clients[0].status("SUBSCRIBED"); h.clients[0].deliver({ payload: frame() });
    const states: LiveViewerState[] = [];
    const stop = h.subscribe("00000000-0000-4000-8000-000000000002", state => states.push(state));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(states.at(-1)?.snapshot).toBeNull();
    h.clients[1].deliver({ payload: frame() });
    expect(states.at(-1)?.snapshot).toBeNull();
    h.clients[0].status("CHANNEL_ERROR");
    const reentry: LiveViewerState[] = [];
    const stopReentry = h.subscribe(fixture.snapshot.matchId, state => reentry.push(state));
    expect(reentry.at(-1)?.snapshot).toBeNull();
    const other = setup(true); await vi.advanceTimersByTimeAsync(0);
    expect(other.fetcher).toHaveBeenCalledOnce();
    expect(other.states.at(-1)?.snapshot).toBeNull();
    h.stop(); stop(); stopReentry(); other.stop(); await vi.advanceTimersByTimeAsync(5000);
  });
  it("foreground recovery and token renewal wait for a newly received heartbeat even on re-entry", async () => {
    const h = setup(true); await vi.advanceTimersByTimeAsync(0);
    h.clients[0].status("SUBSCRIBED"); h.clients[0].deliver({ payload: frame() });
    h.stop(); h.hide();
    const states: LiveViewerState[] = [];
    const stop = h.subscribe(fixture.snapshot.matchId, state => states.push(state));
    expect(states.at(-1)?.snapshot).toBeNull();
    h.show(); await vi.advanceTimersByTimeAsync(0);
    h.clients[1].status("SUBSCRIBED"); h.clients[1].deliver({ payload: frame() });
    expect(states.at(-1)?.snapshot).toBeNull();
    const next = frame(); next.delivery.sequence++;
    h.clients[1].deliver({ payload: next });
    expect(states.at(-1)?.snapshot).not.toBeNull();
    await vi.advanceTimersByTimeAsync(270000);
    expect(states.at(-1)?.snapshot).toBeNull();
    expect(h.fetcher).toHaveBeenCalledTimes(3);
    stop(); await vi.advanceTimersByTimeAsync(5000);
  });
});

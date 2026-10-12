import { afterEach, describe, expect, it, vi } from "vitest";
import type { createLiveViewerClient } from "@/lib/auth/supabase";
import { connectLiveViewer, type ViewerEnvironment } from "./live-viewer";
import { createLiveViewerSubscriptions } from "./live-viewer-subscriptions";
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
});

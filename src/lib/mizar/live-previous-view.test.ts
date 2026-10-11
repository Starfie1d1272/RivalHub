import { afterEach, describe, expect, it, vi } from "vitest";
import { createPreviousLiveViewStore } from "./live-previous-view";
import { projectPublicLive } from "./live-projection";
import { parseLiveSnapshotV1 } from "./protocol";
import fixture from "../../../tests/fixtures/contracts/mizar-live-real-derived.json";

const wire = parseLiveSnapshotV1(fixture.snapshot);
wire.competitionId = "40000000-0000-4000-8000-000000000001";
wire.matchId = "40000000-0000-4000-8000-000000000002";
wire.map.mapId = "40000000-0000-4000-8000-000000000003";
const frame = projectPublicLive(wire, 1, wire.producedAt);
const time = Date.parse(frame.receivedAt);
const context = { schemaVersion: "rivalhub.previous-live.v1", seasonId: wire.competitionId, matchId: wire.matchId,
  revision: "a".repeat(64), checkedAt: time,
  boundary: { ...frame.delivery, mapId: frame.map.mapId },
};
delete (context.boundary as Partial<typeof frame.delivery>).sequence;
function setup() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const store = createPreviousLiveViewStore(storage, "local");
  expect(store.authorize(context, wire.matchId, 0, 0)).toBeNull();
  return { store, values, reload: () => createPreviousLiveViewStore(storage, "local") };
}
describe("verified previous public view", () => {
  afterEach(() => vi.useRealTimers());
  it("removes idle recorded data at the original deadline without extending the receiver", async () => {
    vi.useFakeTimers();
    const h = setup(); h.store.remember(frame, 0); h.store.forget(wire.matchId);
    await vi.advanceTimersByTimeAsync(30000);
    expect(h.values.size).toBe(0);
  });
  it("cannot restore without new authoritative proof and does not renew time across reloads", () => {
    const h = setup();
    expect(h.store.remember(frame, 0)?.expiresAt).toBe(30000);
    const restored = h.reload().authorize({ ...context, checkedAt: time + 20000 }, wire.matchId, 5, 100);
    expect(restored?.expiresAt).toBe(9905);
    expect(restored?.snapshot.receivedAt).toBe(frame.receivedAt);
    expect(restored?.snapshot.radar).toBeNull();
    expect(h.reload().authorize({ ...context, checkedAt: time + 30000 }, wire.matchId, 0, 0)).toBeNull();
    expect(h.values.size).toBe(0);
  });
  it("drops mismatched login/context/source/map/schema and unknown or revoked qualification", () => {
    for (const proof of [null, { ...context, revision: "b".repeat(64) }, { ...context, seasonId: "00000000-0000-4000-8000-000000000002" },
      { ...context, boundary: { ...context.boundary, epoch: context.boundary.epoch + 1 } },
      { ...context, boundary: { ...context.boundary, mapId: "00000000-0000-4000-8000-000000000002" } }, { ...context, schemaVersion: "unknown" }]) {
      const h = setup(); h.store.remember(frame, 0);
      expect(h.reload().authorize(proof, wire.matchId, 0, 0)).toBeNull();
      expect(h.values.size).toBe(0);
    }
  });
  it("fails closed on time reversal, delayed authorization, corruption and storage denial", () => {
    const h = setup(); h.store.remember(frame, 0);
    expect(h.reload().authorize({ ...context, checkedAt: time - 1 }, wire.matchId, 0, 0)).toBeNull();
    h.store.remember(frame, 1000);
    expect(h.reload().authorize(context, wire.matchId, 0, 10001)).toBeNull();
    h.values.set("rivalhub:previous-live:v1:local", "{broken");
    expect(h.reload().authorize(context, wire.matchId, 0, 0)).toBeNull();
    const broken = createPreviousLiveViewStore({ getItem() { throw Error("denied"); }, setItem() { throw Error("quota"); }, removeItem() { throw Error("denied"); } }, "local");
    expect(broken.authorize(context, wire.matchId, 0, 0)).toBeNull();
    expect(() => broken.remember(frame, 0)).not.toThrow();
  });
  it("keeps at most two matches and never transfers frames to another match", () => {
    const h = setup();
    for (let index = 1; index <= 3; index++) {
      const matchId = `00000000-0000-4000-8000-00000000000${index}`;
      h.store.authorize({ ...context, matchId }, matchId, 0, 0);
      h.store.remember({ ...frame, matchId }, 0);
    }
    expect(JSON.parse([...h.values.values()][0]!)).toHaveLength(2);
    expect(h.reload().authorize(context, wire.matchId, 0, 0)).toBeNull();
    h.store.clearAll(); expect(h.values.size).toBe(0);
  });
  it("does not cache a newly observed boundary under an old proof or refresh storage every frame", () => {
    const h = setup(); h.store.remember(frame, 0);
    const saved = [...h.values.values()][0];
    h.store.remember({ ...frame, delivery: { ...frame.delivery, sequence: frame.delivery.sequence + 1 } }, 100);
    expect([...h.values.values()][0]).toBe(saved);
    expect(h.store.remember({ ...frame, delivery: { ...frame.delivery, authorityRevision: frame.delivery.authorityRevision + 1 } }, 1000)).toBeNull();
    expect(h.values.size).toBe(0);
  });
});

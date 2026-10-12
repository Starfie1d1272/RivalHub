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
});

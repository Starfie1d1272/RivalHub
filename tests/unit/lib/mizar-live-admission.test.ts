import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parseLiveSnapshotV1 } from "@/lib/mizar/protocol";

const clock = vi.hoisted(() => ({ now: 0 }));
vi.mock("node:perf_hooks", () => ({ performance: { now: () => clock.now } }));
const wire = JSON.parse(
  readFileSync(
    new URL(
      "../../fixtures/contracts/mizar-live-snapshot-v1.radar.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
afterEach(() => {
  vi.resetModules();
  clock.now = 0;
});
describe("bounded LIVE admission metadata", () => {
  it("reserves no queue and releases each request permit once", async () => {
    const { tryAdmitLiveRequest } = await import("@/lib/mizar/live-admission");
    const a = tryAdmitLiveRequest()!;
    const b = tryAdmitLiveRequest()!;
    expect(tryAdmitLiveRequest()).toBeNull();
    a();
    a();
    const c = tryAdmitLiveRequest()!;
    expect(c).toBeTypeOf("function");
    expect(tryAdmitLiveRequest()).toBeNull();
    b();
    c();
  });
  it("drops reordered/duplicate frames but accepts newer same-sequence heartbeat and source reset", async () => {
    const { admitLiveDelivery } = await import("@/lib/mizar/live-admission");
    const snapshot = parseLiveSnapshotV1(wire);
    expect(admitLiveDelivery(snapshot, 1)).toBe(true);
    clock.now = 500;
    expect(admitLiveDelivery(snapshot, 1)).toBe(false);
    const heartbeat = { ...snapshot, producedAt: "2026-09-28T00:00:00.500Z" };
    expect(admitLiveDelivery(heartbeat, 1)).toBe(true);
    clock.now = 1000;
    expect(
      admitLiveDelivery(
        {
          ...heartbeat,
          producedAt: "2026-09-28T00:00:01.000Z",
          cursor: { ...heartbeat.cursor, runtimeSeq: 0 },
        },
        1,
      ),
    ).toBe(false);
    expect(admitLiveDelivery(snapshot, 2)).toBe(true);
    clock.now = 1100;
    expect(
      admitLiveDelivery(
        { ...snapshot, producedAt: "2026-09-28T00:00:02.000Z" },
        2,
      ),
    ).toBe(true);
    expect(
      admitLiveDelivery(
        { ...snapshot, producedAt: "2026-09-28T00:00:03.000Z" },
        2,
      ),
    ).toBe(false);
  });
  it("absorbs arrival jitter without exceeding a two-token sustained 2/s budget", async () => {
    const { admitLiveDelivery } = await import("@/lib/mizar/live-admission");
    const snapshot = parseLiveSnapshotV1(wire);
    for (const ms of [0, 490, 1010, 1490, 2000]) {
      clock.now = ms;
      expect(
        admitLiveDelivery(
          {
            ...snapshot,
            producedAt: new Date(
              Date.parse(snapshot.producedAt) + ms,
            ).toISOString(),
          },
          1,
        ),
      ).toBe(true);
    }
    clock.now = 3000;
    expect(
      admitLiveDelivery(
        { ...snapshot, producedAt: "2026-09-28T00:00:09.000Z" },
        1,
      ),
    ).toBe(true);
    expect(
      admitLiveDelivery(
        { ...snapshot, producedAt: "2026-09-28T00:00:10.000Z" },
        1,
      ),
    ).toBe(true);
    expect(
      admitLiveDelivery(
        { ...snapshot, producedAt: "2026-09-28T00:00:11.000Z" },
        1,
      ),
    ).toBe(false);
  });
  it("bounds keys without eviction bypass, expires metadata and never holds snapshots", async () => {
    const { admitLiveDelivery } = await import("@/lib/mizar/live-admission");
    const snapshot = parseLiveSnapshotV1(wire);
    for (let i = 0; i < 256; i++)
      expect(admitLiveDelivery({ ...snapshot, matchId: `match-${i}` }, 1)).toBe(
        true,
      );
    expect(admitLiveDelivery({ ...snapshot, matchId: "overflow" }, 1)).toBe(
      false,
    );
    clock.now = 10000;
    expect(admitLiveDelivery({ ...snapshot, matchId: "overflow" }, 1)).toBe(
      true,
    );
  });
});

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
  vi.useRealTimers();
  vi.resetModules();
  clock.now = 0;
});
describe("bounded LIVE admission metadata", () => {
  it("reserves no queue and releases each request permit once", async () => {
    const { tryAdmitLiveRequest } = await import("@/lib/mizar/live-admission");
    const a = tryAdmitLiveRequest("A")!;
    const b = tryAdmitLiveRequest("B")!;
    expect(tryAdmitLiveRequest("C")).toBeNull();
    a();
    a();
    const c = tryAdmitLiveRequest("C")!;
    expect(c).toBeTypeOf("function");
    expect(tryAdmitLiveRequest("D")).toBeNull();
    b();
    c();
  });
  it("gives every synchronous source continuing admissions instead of starving C/D", async () => {
    const { tryAdmitLiveRequest } = await import("@/lib/mizar/live-admission");
    const sources = ["A", "B", "C", "D"];
    const counts = [0, 0, 0, 0], last = [0, 0, 0, 0], gaps = [0, 0, 0, 0];
    for (let round = 0; round < 20; round++) {
      clock.now = round * 500;
      const releases = sources.map((source, i) => {
        // The cast lets this regression execute against the no-argument baseline.
        const release = (tryAdmitLiveRequest as (key: string) => (() => void) | null)(source);
        if (release) { counts[i]++; gaps[i] = Math.max(gaps[i], clock.now - last[i]); last[i] = clock.now; }
        return release;
      });
      releases.forEach(release => release?.());
    }
    const perSource = sources.map((source, i) => ({ source, accepted: counts[i], maxStarvationMs: Math.max(gaps[i], 10000 - last[i]) }));
    console.info(JSON.stringify({ synchronousAdmission: perSource }));
    expect(counts).toEqual([10, 10, 10, 10]);
    expect(perSource.every(row => row.maxStarvationMs <= 1000)).toBe(true);
  });
  it.each([700, 2000])("keeps recurring sources moving with %ims permit occupancy", async (duration) => {
    const { tryAdmitLiveRequest } = await import("@/lib/mizar/live-admission");
    const counts = [0, 0, 0, 0], last = [0, 0, 0, 0], gaps = [0, 0, 0, 0];
    const running: Array<{ until: number; release: () => void }> = [];
    for (let tick = 0; tick < 60; tick++) {
      clock.now = tick * 500;
      for (let i = running.length - 1; i >= 0; i--) {
        if (running[i]!.until <= clock.now) { running[i]!.release(); running.splice(i, 1); }
      }
      for (let i = 0; i < 4; i++) {
        const release = tryAdmitLiveRequest(`installation:match-${i}`);
        if (!release) continue;
        counts[i]++; gaps[i] = Math.max(gaps[i]!, clock.now - last[i]!); last[i] = clock.now;
        running.push({ until: clock.now + duration, release });
      }
      expect(running.length).toBeLessThanOrEqual(2);
    }
    running.forEach(row => row.release());
    console.info(JSON.stringify({ duration, counts, gaps }));
    expect(counts.every(count => count >= 7)).toBe(true);
    expect(gaps.every(gap => gap <= 2 * Math.ceil(duration / 500) * 500)).toBe(true);
  });
  it("bounds demand metadata, expires silent tickets and prevents a single-source burst taking both permits", async () => {
    const { tryAdmitLiveRequest } = await import("@/lib/mizar/live-admission");
    const a = tryAdmitLiveRequest("A")!, b = tryAdmitLiveRequest("B")!;
    for (let i = 0; i < 1000; i++) expect(tryAdmitLiveRequest("A")).toBeNull();
    for (let i = 0; i < 256; i++) expect(tryAdmitLiveRequest(`demand-${i}`)).toBeNull();
    a(); b();
    expect(tryAdmitLiveRequest("overflow")).toBeNull();
    clock.now = 1500;
    const recovered = tryAdmitLiveRequest("legitimate")!;
    expect(recovered).toBeTypeOf("function"); recovered();
  });
  it("bounds FIFO ingress and expires waiting requests without retaining parsed frames", async () => {
    vi.useFakeTimers();
    const { admitLiveIngress } = await import("@/lib/mizar/live-admission");
    const first = (await admitLiveIngress())!;
    const second = (await admitLiveIngress())!;
    const waiting = Array.from({ length: 256 }, () => admitLiveIngress());
    expect(await admitLiveIngress()).toBeNull();
    await vi.advanceTimersByTimeAsync(500);
    expect((await Promise.all(waiting)).every(value => value === null)).toBe(true);
    first(); first(); second();
    const next = (await admitLiveIngress())!;
    expect(next).toBeTypeOf("function"); next();
  });
  it("admits all synchronous healthy ingress in FIFO order before slow delivery can block parsing", async () => {
    const { admitLiveIngress } = await import("@/lib/mizar/live-admission");
    const order: number[] = [];
    await Promise.all([0, 1, 2, 3].map(async i => {
      const release = await admitLiveIngress();
      expect(release).toBeTypeOf("function"); order.push(i); release!();
    }));
    expect(order).toEqual([0, 1, 2, 3]);
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

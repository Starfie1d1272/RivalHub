import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { allocateHeldCoverageInTx, holdCoverageInTx } from "@/lib/matches/coverage";
import { seedFixture } from "./harness/mizar";
import { createLocalPool } from "./harness/database";

it.each([true, false])("does not allocate an expired hold after waiting for its slot (reclaimed=%s)", async (reclaimed) => {
  const fixture = await seedFixture({ matchStatus: "scheduled" });
  const match = (await db.query.matches.findFirst({ where: eq(schema.matches.id, fixture.matchId) }))!;
  const [other] = await db.insert(schema.matches).values({ seasonId: fixture.seasonId, entryAId: fixture.entryAId, entryBId: fixture.entryBId, stage: "fixture-stage", status: "scheduled" }).returning();
  const now = new Date();
  let current = now;
  const expires = new Date(now.getTime() + 15 * 60_000);
  const scheduledAt = new Date(now.getTime() + 2 * 3_600_000);
  const [slot] = await db.insert(schema.officialCoverageSlots).values({ seasonId: fixture.seasonId, startsAt: now, endsAt: new Date(now.getTime() + 4 * 3_600_000), capacity: 1 }).returning();
  await db.transaction(tx => holdCoverageInTx(tx, match, slot.id, scheduledAt, now));
  const locked = Promise.withResolvers<number>();
  const reclaim = Promise.withResolvers<void>();
  const reclaimer = db.transaction(async tx => {
    await tx.select().from(schema.matches).where(eq(schema.matches.id, other.id)).for("update");
    await tx.select().from(schema.officialCoverageSlots).where(eq(schema.officialCoverageSlots.id, slot.id)).for("update");
    const pid = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
    locked.resolve(pid.rows[0]!.pid);
    await reclaim.promise;
    if (reclaimed) {
      await holdCoverageInTx(tx, other, slot.id, scheduledAt, expires);
      await allocateHeldCoverageInTx(tx, other.id, scheduledAt, () => expires);
    }
  });
  const pool = createLocalPool();
  let contender: Promise<void> | undefined;
  try {
    const pid = await locked.promise;
    contender = db.transaction(async tx => {
      await tx.select().from(schema.matches).where(eq(schema.matches.id, match.id)).for("update");
      await allocateHeldCoverageInTx(tx, match.id, scheduledAt, () => current);
    });
    await vi.waitFor(async () => {
      const result = await pool.query("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked", [pid]);
      expect(result.rows[0].blocked).toBe(true);
    });
    current = expires;
    reclaim.resolve();
    await Promise.all([reclaimer, contender]);
    const allocations = await db.select().from(schema.coverageAllocations).where(and(eq(schema.coverageAllocations.slotId, slot.id), isNull(schema.coverageAllocations.releasedAt)));
    expect(allocations.map(row => row.matchId)).toEqual(reclaimed ? [other.id] : []);
  } finally {
    reclaim.resolve();
    await Promise.allSettled([reclaimer, contender]);
    await pool.end();
  }
});

it("preserves confirmed coverage during a proposal, enforces capacity, and replaces it only on settlement", async () => {
  const fixture = await seedFixture({ matchStatus: "scheduled" });
  const now = new Date("2026-09-28T09:00:00Z");
  const oldTime = new Date("2026-09-28T10:00:00Z");
  const nextTime = new Date("2026-09-28T11:00:00Z");
  const slotId = randomUUID();
  await db.insert(schema.officialCoverageSlots).values({ id: slotId, seasonId: fixture.seasonId, startsAt: oldTime, endsAt: new Date("2026-09-28T12:00:00Z"), capacity: 1 });
  const [previous] = await db.insert(schema.coverageAllocations).values({ slotId, matchId: fixture.matchId, scheduledAt: oldTime }).returning();
  const match = (await db.query.matches.findFirst({ where: eq(schema.matches.id, fixture.matchId) }))!;
  const [other] = await db.insert(schema.matches).values({ seasonId: fixture.seasonId, entryAId: fixture.entryAId, entryBId: fixture.entryBId, stage: "fixture-stage", status: "scheduled" }).returning();

  const hold = await db.transaction(tx => holdCoverageInTx(tx, match, slotId, nextTime, now));
  expect(await db.query.coverageAllocations.findFirst({ where: eq(schema.coverageAllocations.id, previous.id) })).toEqual(previous);
  expect(hold).toMatchObject({ matchId: match.id, proposedScheduledAt: nextTime, releasedAt: null });
  await expect(db.transaction(tx => holdCoverageInTx(tx, other, slotId, nextTime, now))).rejects.toThrow("名额已满");
  expect(await db.query.coverageHolds.findMany({ where: eq(schema.coverageHolds.matchId, other.id) })).toEqual([]);

  await db.transaction(tx => allocateHeldCoverageInTx(tx, match.id, nextTime, () => now));
  expect(await db.query.coverageAllocations.findMany({ where: eq(schema.coverageAllocations.matchId, match.id) })).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: previous.id, scheduledAt: oldTime, releasedAt: now }),
    expect.objectContaining({ scheduledAt: nextTime, releasedAt: null }),
  ]));
  expect(await db.query.coverageHolds.findFirst({ where: eq(schema.coverageHolds.id, hold.id) })).toMatchObject({ releasedAt: now });

  const replacement = await db.transaction(tx => holdCoverageInTx(tx, match, slotId, oldTime, now));
  const expired = new Date(now.getTime() + 15 * 60_000);
  await db.transaction(tx => allocateHeldCoverageInTx(tx, match.id, oldTime, () => expired));
  const rows = await db.query.coverageAllocations.findMany({ where: eq(schema.coverageAllocations.matchId, match.id) });
  expect(rows).toHaveLength(2);
  expect(rows.every(row => row.releasedAt !== null)).toBe(true);
  expect(await db.query.coverageHolds.findFirst({ where: eq(schema.coverageHolds.id, replacement.id) })).toMatchObject({ releasedAt: expired });
});

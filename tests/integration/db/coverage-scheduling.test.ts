import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { allocateHeldCoverageInTx, holdCoverageInTx } from "@/lib/matches/coverage";
import { seedFixture } from "./harness/mizar";

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

  await db.transaction(tx => allocateHeldCoverageInTx(tx, match.id, nextTime, now));
  expect(await db.query.coverageAllocations.findMany({ where: eq(schema.coverageAllocations.matchId, match.id) })).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: previous.id, scheduledAt: oldTime, releasedAt: now }),
    expect.objectContaining({ scheduledAt: nextTime, releasedAt: null }),
  ]));
  expect(await db.query.coverageHolds.findFirst({ where: eq(schema.coverageHolds.id, hold.id) })).toMatchObject({ releasedAt: now });

  const replacement = await db.transaction(tx => holdCoverageInTx(tx, match, slotId, oldTime, now));
  const expired = new Date(now.getTime() + 15 * 60_000);
  await db.transaction(tx => allocateHeldCoverageInTx(tx, match.id, oldTime, expired));
  const rows = await db.query.coverageAllocations.findMany({ where: eq(schema.coverageAllocations.matchId, match.id) });
  expect(rows).toHaveLength(2);
  expect(rows.every(row => row.releasedAt !== null)).toBe(true);
  expect(await db.query.coverageHolds.findFirst({ where: eq(schema.coverageHolds.id, replacement.id) })).toMatchObject({ releasedAt: expired });
});

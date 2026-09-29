import "server-only";
import { and, eq, isNull, lte, count, ne } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { coverageHolds, coverageAllocations, officialCoverageSlots, type Match } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";

/** Caller locks Match first; slot lock serializes all capacity decisions. */
export async function holdCoverageInTx(tx: TxDb, match: Match, slotId: string, scheduledAt: Date, now = new Date()) {
  const [slot] = await tx.select().from(officialCoverageSlots).where(eq(officialCoverageSlots.id, slotId)).for("update");
  if (!slot || slot.seasonId !== match.seasonId || match.status !== "scheduled" || scheduledAt < slot.startsAt || scheduledAt >= slot.endsAt) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "所选时间不在可用官方转播时段内。");
  }
  await tx.update(coverageHolds).set({ releasedAt: now }).where(and(eq(coverageHolds.slotId, slot.id), isNull(coverageHolds.releasedAt), lte(coverageHolds.expiresAt, now)));
  await releaseMatchCoverageHoldInTx(tx, match.id, now);
  const [holds] = await tx.select({ total: count() }).from(coverageHolds).where(and(eq(coverageHolds.slotId, slot.id), isNull(coverageHolds.releasedAt)));
  const [allocations] = await tx.select({ total: count() }).from(coverageAllocations).where(and(
    eq(coverageAllocations.slotId, slot.id),
    isNull(coverageAllocations.releasedAt),
    ne(coverageAllocations.matchId, match.id),
  ));
  if (holds.total + allocations.total >= slot.capacity) throw new AppError(ErrorCode.VALIDATION_FAILED, "该时段转播名额已满，仍可自由约定比赛时间。");
  const [hold] = await tx.insert(coverageHolds).values({ slotId: slot.id, matchId: match.id, proposedScheduledAt: scheduledAt, expiresAt: new Date(now.getTime() + 15 * 60_000) }).returning();
  return hold;
}

export async function releaseMatchCoverageHoldInTx(tx: TxDb, matchId: string, now = new Date()) {
  await tx.update(coverageHolds).set({ releasedAt: now }).where(and(eq(coverageHolds.matchId, matchId), isNull(coverageHolds.releasedAt)));
}

async function releaseMatchCoverageAllocationInTx(tx: TxDb, matchId: string, now = new Date()) {
  await tx.update(coverageAllocations).set({ releasedAt: now }).where(and(eq(coverageAllocations.matchId, matchId), isNull(coverageAllocations.releasedAt)));
}

export async function releaseMatchCoverageInTx(tx: TxDb, matchId: string, now = new Date()) {
  await releaseMatchCoverageHoldInTx(tx, matchId, now);
  await releaseMatchCoverageAllocationInTx(tx, matchId, now);
}

/** Settling a new official time replaces the previous allocation; an expired/missing hold means no coverage for the new time. */
export async function allocateHeldCoverageInTx(tx: TxDb, matchId: string, scheduledAt: Date, now = new Date()) {
  const [hold] = await tx.select().from(coverageHolds).where(and(eq(coverageHolds.matchId, matchId), isNull(coverageHolds.releasedAt)));
  await releaseMatchCoverageAllocationInTx(tx, matchId, now);
  if (!hold) return;
  await tx.select({ id: officialCoverageSlots.id }).from(officialCoverageSlots).where(eq(officialCoverageSlots.id, hold.slotId)).for("update");
  if (hold.expiresAt > now && hold.proposedScheduledAt.getTime() === scheduledAt.getTime()) {
    await tx.insert(coverageAllocations).values({ slotId: hold.slotId, matchId, scheduledAt });
  }
  await tx.update(coverageHolds).set({ releasedAt: now }).where(eq(coverageHolds.id, hold.id));
}

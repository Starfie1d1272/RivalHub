import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { coverageAllocations, coverageHolds, matchLiveSessions, mizarInstallations, officialCoverageSlots, seasons, users } from "@/db/schema";

/** One read model for season operations; no internal rows cross into Client props. */
export async function loadMatchOperationsOverview(seasonId: string, matchIds: string[]) {
  const [slots, devices, [seasonBrand], sessions] = await Promise.all([
    db.select().from(officialCoverageSlots).where(eq(officialCoverageSlots.seasonId, seasonId)).orderBy(officialCoverageSlots.startsAt),
    db.select({ id: mizarInstallations.id, displayName: users.displayName, lastSeenAt: mizarInstallations.lastSeenAt }).from(mizarInstallations).innerJoin(users, eq(users.id, mizarInstallations.authorizedByUserId)).where(and(eq(mizarInstallations.competitionId, seasonId), isNull(mizarInstallations.revokedAt))),
    db.select({ logoUrl: seasons.logoUrl }).from(seasons).where(eq(seasons.id, seasonId)),
    matchIds.length ? db.select({ matchId: matchLiveSessions.matchId, identity: matchLiveSessions.identityHealth, lineup: matchLiveSessions.lineupHealth, continuity: matchLiveSessions.continuityHealth }).from(matchLiveSessions).where(and(inArray(matchLiveSessions.matchId, matchIds), isNull(matchLiveSessions.closedAt))) : Promise.resolve([]),
  ]);
  const activeHolds = slots.length ? await db.select({ slotId: coverageHolds.slotId, expiresAt: coverageHolds.expiresAt }).from(coverageHolds).where(and(inArray(coverageHolds.slotId, slots.map(slot => slot.id)), isNull(coverageHolds.releasedAt))) : [];
  const activeAllocations = slots.length ? await db.select({ slotId: coverageAllocations.slotId }).from(coverageAllocations).where(and(inArray(coverageAllocations.slotId, slots.map(slot => slot.id)), isNull(coverageAllocations.releasedAt))) : [];
  const now = Date.now();
  return {
    now,
    logoUrl: seasonBrand?.logoUrl ?? null,
    slots: slots.map(slot => ({ id: slot.id, startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString(), capacity: slot.capacity, note: slot.note, occupied: activeAllocations.filter(allocation => allocation.slotId === slot.id).length + activeHolds.filter(hold => hold.slotId === slot.id && hold.expiresAt.getTime() > now).length })),
    devices: devices.map(device => ({ ...device, displayName: device.displayName?.trim() || "未设置显示名的管理员", lastSeenAt: device.lastSeenAt?.toISOString() ?? null })),
    conflicts: new Set(sessions.filter(session => [session.identity, session.lineup, session.continuity].includes("conflict")).map(session => session.matchId)),
  };
}

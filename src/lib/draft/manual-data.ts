import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, competitionEntryRosterMembers, seasonRegistrations, users } from "@/db/schema";

export async function getManualFormationData(seasonId: string) {
  const [players, entries] = await Promise.all([
    db.select({ id: seasonRegistrations.id, userId: seasonRegistrations.userId, name: users.displayName, perfectName: users.perfectName }).from(seasonRegistrations)
      .innerJoin(users, eq(users.id, seasonRegistrations.userId)).where(and(eq(seasonRegistrations.seasonId, seasonId), eq(seasonRegistrations.status, "approved"), eq(users.status, "active"))),
    db.select({ id: competitionEntries.id, name: competitionEntries.name, logoUrl: competitionEntries.logoUrl, captainId: competitionEntries.sourceRegistrationId, revisionId: competitionEntries.currentRosterRevisionId, approvedId: competitionEntries.approvedRosterRevisionId, status: competitionEntries.registrationStatus }).from(competitionEntries)
      .where(and(eq(competitionEntries.competitionId, seasonId), eq(competitionEntries.source, "event_native"), inArray(competitionEntries.registrationStatus, ["draft", "changes_requested", "approved", "submitted", "waitlisted"]))),
  ]);
  const members = entries.length ? await db.select({ revisionId: competitionEntryRosterMembers.revisionId, userId: competitionEntryRosterMembers.userId, starter: competitionEntryRosterMembers.isPrimaryStarter }).from(competitionEntryRosterMembers).where(inArray(competitionEntryRosterMembers.revisionId, entries.map(entry => entry.revisionId))) : [];
  const registrationByUser = new Map(players.map(player => [player.userId, player.id]));
  return { players: players.map(player => ({ id: player.id, name: player.name || player.perfectName || "未命名选手" })), teams: entries.filter(entry => entry.captainId !== null).map(entry => ({ id: entry.id, name: entry.name, logoUrl: entry.logoUrl, revisionId: entry.revisionId, approvedId: entry.approvedId, captainId: entry.captainId!, approved: entry.status === "approved" || members.some(member => member.revisionId === entry.revisionId && !registrationByUser.has(member.userId)), members: members.filter(member => member.revisionId === entry.revisionId).flatMap(member => { const id = registrationByUser.get(member.userId); return id ? [{ id, starter: member.starter }] : []; }) })) };
}

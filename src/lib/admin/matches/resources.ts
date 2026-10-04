import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { mizarInstallations, matchLiveSessions, matches, users } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { getDisplayName } from "@/lib/identity/display-name";
import { readUploaderDownloads } from "@/lib/production/uploader";

export async function loadMatchResources(seasonId: string) {
  const actor = await requireSeasonAdmin(seasonId);
  const [rows, downloads] = await Promise.all([
    db.select({ id: mizarInstallations.id, ownerId: mizarInstallations.authorizedByUserId, displayName: users.displayName, lastSeenAt: mizarInstallations.lastSeenAt }).from(mizarInstallations).innerJoin(users, eq(users.id, mizarInstallations.authorizedByUserId)).where(and(eq(mizarInstallations.competitionId, seasonId), isNull(mizarInstallations.revokedAt))),
    readUploaderDownloads(),
  ]);
  const active = await db.select({ installationId: matchLiveSessions.installationId, matchId: matches.id, round: matches.round }).from(matchLiveSessions).innerJoin(matches, eq(matches.id, matchLiveSessions.matchId)).where(and(eq(matches.seasonId, seasonId), isNull(matchLiveSessions.closedAt)));
  return { installations: rows.map(row => ({ id: row.id, canRevoke: row.ownerId === actor.userId || actor.role === "super_admin", owned: row.ownerId === actor.userId, activeMatches: active.filter(item => item.installationId === row.id).map(item => ({ id: item.matchId, label: item.round ? `第 ${item.round} 轮比赛` : "进行中的比赛" })), name: getDisplayName(row), lastSeenAt: row.lastSeenAt?.toISOString() ?? null })), downloads };
}

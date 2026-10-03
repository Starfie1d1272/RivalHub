import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { mizarInstallations, users } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { getDisplayName } from "@/lib/identity/display-name";
import { readUploaderDownloads } from "@/lib/production/uploader";

export async function loadMatchResources(seasonId: string) {
  await requireSeasonAdmin(seasonId);
  const [rows, downloads] = await Promise.all([
    db.select({ id: mizarInstallations.id, displayName: users.displayName, lastSeenAt: mizarInstallations.lastSeenAt }).from(mizarInstallations).innerJoin(users, eq(users.id, mizarInstallations.authorizedByUserId)).where(and(eq(mizarInstallations.competitionId, seasonId), isNull(mizarInstallations.revokedAt))),
    readUploaderDownloads(),
  ]);
  return { installations: rows.map(row => ({ id: row.id, name: getDisplayName(row), lastSeenAt: row.lastSeenAt?.toISOString() ?? null })), downloads };
}

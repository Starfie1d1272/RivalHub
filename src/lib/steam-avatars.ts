import "server-only";

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { getSteamPlayerSummaries } from "@/lib/steam";
import { revalidatePublicPlayerTag } from "@/lib/revalidation";

export async function refreshSteamAvatars() {
  const candidates = await db.select({ id: users.id, steam64: users.steam64, avatarUrl: users.avatarUrl }).from(users)
    .where(and(eq(users.status, "active"), isNotNull(users.steam64)));
  const result = await getSteamPlayerSummaries(candidates.map((user) => user.steam64!));
  if (result.status !== "ok") throw new Error(result.status === "unconfigured" ? "STEAM_AVATAR_UNCONFIGURED" : "STEAM_AVATAR_PROVIDER_FAILED");
  let updated = 0;
  let unresolved = 0;
  for (const user of candidates) {
    const avatarUrl = result.avatars.get(user.steam64!);
    if (!avatarUrl) { unresolved += 1; continue; }
    if (avatarUrl === user.avatarUrl) continue;
    // Re-check identity after provider I/O: a concurrent profile save wins.
    const changed = await db.update(users).set({ avatarUrl }).where(and(
      eq(users.id, user.id), eq(users.status, "active"), eq(users.steam64, user.steam64!),
      sql`${users.avatarUrl} is distinct from ${avatarUrl}`,
    )).returning({ id: users.id });
    if (changed.length) { updated += 1; revalidatePublicPlayerTag(user.id); }
  }
  return { processed: candidates.length, updated, unresolved };
}

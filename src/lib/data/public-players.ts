import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { steamProfiles, users } from "@/db/schema";
import { publicPlayerTag } from "@/lib/cache/tags";
import { normalizeSteamProfileUrl } from "@/lib/external-url";

export interface PublicPlayer {
  id: string;
  displayName: string | null;
  perfectName: string | null;
  personaName: string | null;
  steamProfileUrl: string | null;
  avatarUrl: string | null;
  gameplayStyle: string | null;
  competitionHistory: string | null;
}

const publicPlayerColumns = {
  id: users.id,
  displayName: users.displayName,
  perfectName: users.perfectName,
  personaName: steamProfiles.personaName,
  steamProfileUrl: steamProfiles.profileUrl,
  avatarUrl: steamProfiles.avatarUrl,
  gameplayStyle: users.gameplayStyle,
  competitionHistory: users.competitionHistory,
} as const;

export async function getPublicPlayerById(userId: string): Promise<PublicPlayer | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag(publicPlayerTag(userId));

  const [player] = await db
    .select(publicPlayerColumns)
    .from(users)
    .leftJoin(steamProfiles, eq(users.steam64, steamProfiles.steam64))
    .where(and(eq(users.id, userId), eq(users.status, "active")))
    .limit(1);

  if (!player) return null;

  return {
    ...player,
    steamProfileUrl: normalizeSteamProfileUrl(player.steamProfileUrl),
  };
}

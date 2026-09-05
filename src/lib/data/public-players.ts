import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { publicPlayerTag } from "@/lib/cache/tags";
import { normalizeSteamProfileUrl } from "@/lib/external-url";

export interface PublicPlayer {
  id: string;
  displayName: string | null;
  perfectName: string | null;
  steamName: string | null;
  steamProfileUrl: string | null;
  avatarUrl: string | null;
}

const publicPlayerColumns = {
  id: users.id,
  displayName: users.displayName,
  perfectName: users.perfectName,
  steamName: users.steamName,
  steamProfileUrl: users.steamProfileUrl,
  avatarUrl: users.avatarUrl,
} as const;

export async function getPublicPlayerById(userId: string): Promise<PublicPlayer | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag(publicPlayerTag(userId));

  const [player] = await db
    .select(publicPlayerColumns)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!player) return null;

  return {
    ...player,
    steamProfileUrl: normalizeSteamProfileUrl(player.steamProfileUrl),
  };
}

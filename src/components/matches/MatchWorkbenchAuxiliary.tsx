import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { matchCommentators, matches, steamProfiles, users } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { getDisplayName } from "@/lib/identity/display-name";
import { readBilibiliStatus, BROADCAST_STATUS_LABEL } from "@/lib/production/bilibili";
import { readUploaderDownloads } from "@/lib/production/uploader";
import { MatchDownloads } from "./MatchDownloads";

export async function MatchBroadcastStatus({ seasonId, matchId }: { seasonId: string; matchId: string }) {
  await requireSeasonAdmin(seasonId);
  const rows = await db.select({ displayName: users.displayName, perfectName: users.perfectName,
    personaName: steamProfiles.personaName, liveStreamUrl: users.liveStreamUrl })
    .from(matchCommentators).innerJoin(matches, eq(matches.id, matchCommentators.matchId))
    .innerJoin(users, eq(users.id, matchCommentators.userId))
    .leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64))
    .where(and(eq(matches.id, matchId), eq(matches.seasonId, seasonId)));
  const statuses = await Promise.all(rows.map(async row => ({
    name: getDisplayName(row), label: BROADCAST_STATUS_LABEL[await readBilibiliStatus(row.liveStreamUrl)],
  })));
  return statuses.length > 0 && <aside aria-label="转播状态" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-fg-mid)]">
    {statuses.map((row, i) => <span key={i}>直播：{row.name} · {row.label}</span>)}
  </aside>;
}

export async function MatchUploaderDownloads({ seasonId }: { seasonId: string }) {
  await requireSeasonAdmin(seasonId);
  return <MatchDownloads downloads={await readUploaderDownloads()} />;
}

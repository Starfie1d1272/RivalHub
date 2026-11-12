import "server-only";

import { eq, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/db/client";
import { steamProfiles, users } from "@/db/schema";
import { PUBLIC_STATS_PLAYER_NAMES_TAG } from "@/lib/cache/tags";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { preservePublicStatsDependencyFailure } from "./availability";
import type { PublicStatsData } from "./public-view";
import { isPlayerRecord } from "./record-facts";

async function readPlayerNames(ids: string[]) {
  "use cache: remote";
  cacheLife({ stale: 60, revalidate: Infinity, expire: Infinity });
  cacheTag(PUBLIC_STATS_PLAYER_NAMES_TAG);
  return preservePublicStatsDependencyFailure(async () => {
    const rows = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        perfectName: users.perfectName,
        personaName: steamProfiles.personaName,
      })
      .from(users)
      .leftJoin(steamProfiles, eq(users.steam64, steamProfiles.steam64))
      .where(sql`${users.id} = ANY(${sql.param(ids)}::uuid[])`);
    return Object.fromEntries(rows.map((row) => [row.id, getPublicDisplayName(row)]));
  });
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PlayerLabel = <Name extends string | null | undefined>(
  id: string | null | undefined,
  current: Name,
) => string | Name;

/** The caller selects the display fields of its DTO. Resolve all selected names in one batch. */
export async function withPublicPlayerLabels<T>(project: (label: PlayerLabel) => T): Promise<T> {
  const ids = new Set<string>();
  const fallback = project((id, current) => {
    if (id && current != null && uuid.test(id)) ids.add(id);
    return current;
  });
  if (!ids.size) return fallback;
  const names = await readPlayerNames([...ids].sort());
  return project((id, current) =>
    id && current != null && ids.has(id) ? (names[id] ?? current) : current,
  );
}

export function labelScoreboardPlayer<T extends { userId: string | null; perfectName: string }>(
  row: T,
  label: PlayerLabel,
): T {
  const perfectName = label(row.userId, row.perfectName);
  return perfectName === row.perfectName ? row : { ...row, perfectName };
}

export function labelPerformancePlayer<
  T extends { player: { entityKey: string; displayName: string } },
>(row: T, label: PlayerLabel): T {
  const { player } = row;
  const displayName = label(player.entityKey, player.displayName);
  return displayName === player.displayName ? row : { ...row, player: { ...player, displayName } };
}

export function labelPublicStatsView(data: PublicStatsData, label: PlayerLabel): PublicStatsData {
  switch (data.tab) {
    case "overview":
      return {
        ...data,
        overview: {
          ...data.overview,
          topPlayers: data.overview.topPlayers.map((row) => labelScoreboardPlayer(row, label)),
          insights: data.overview.insights.map((row) =>
            row.entityType === "player"
              ? { ...row, entityName: label(row.entityKey, row.entityName) }
              : row,
          ),
        },
      };
    case "players":
      return {
        ...data,
        leaderboard: data.leaderboard.map((row) => labelScoreboardPlayer(row, label)),
        performance: {
          ...data.performance,
          players: data.performance.players.map((row) => labelPerformancePlayer(row, label)),
        },
      };
    case "teams":
      return data;
    case "weapons":
      return {
        ...data,
        performance: {
          weapons: data.performance.weapons.map((row) => {
            const topPlayer = row.topPlayer;
            if (!topPlayer) return row;
            const displayName = label(topPlayer.entityKey, topPlayer.displayName);
            return displayName === topPlayer.displayName
              ? row
              : { ...row, topPlayer: { ...topPlayer, displayName } };
          }),
        },
      };
    case "records":
      return {
        ...data,
        records: data.records?.map((record) =>
          isPlayerRecord(record.kind)
            ? {
                ...record,
                holders: record.holders.map((row) => ({ ...row, name: label(row.id, row.name) })),
                occurrences: record.occurrences.map((row) => ({
                  ...row,
                  entityName: label(row.entityId, row.entityName),
                })),
              }
            : record,
        ),
        recordEvents: data.recordEvents && {
          ...data.recordEvents,
          rows: data.recordEvents.rows.map((row) => ({
            ...row,
            entityName: label(row.entityId, row.entityName),
            victimName: label(row.victimId, row.victimName),
          })),
        },
      };
    case "maps":
      return data.mapDetail
        ? {
            ...data,
            mapDetail: {
              ...data.mapDetail,
              performance: {
                ...data.mapDetail.performance,
                players: data.mapDetail.performance.players.map((row) =>
                  labelPerformancePlayer(row, label),
                ),
              },
            },
          }
        : data;
  }
}

import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { ratioOfSums, roundWeightedAvg, simpleAvg } from "./sql";

export interface VerifiedPlayerSeasonStats {
  maps: number;
  avgRating: number | null;
  avgAdr: number | null;
  avgKd: number | null;
}

type VerifiedPlayerStatsRow = {
  user_id: string;
  maps: number | string;
  avg_rating: number | string | null;
  avg_adr: number | string | null;
  avg_kd: number | string | null;
};

/** Shared server-only query for the small verified-stat contract used by directories. */
export async function getVerifiedPlayerStatsBySeason(
  seasonId: string,
  userIds?: readonly string[],
): Promise<Map<string, VerifiedPlayerSeasonStats>> {
  if (userIds && userIds.length === 0) return new Map();
  const userFilter = userIds?.length
    ? sql`AND mps.user_id IN (${sql.join(userIds.map((userId) => sql`${userId}`), sql`, `)})`
    : sql``;
  const result = await db.execute(sql`
    SELECT
      mps.user_id,
      count(distinct mps.map_id)::int AS maps,
      ${simpleAvg("mps.rating_pro")} AS avg_rating,
      ${roundWeightedAvg("mps.adr")} AS avg_adr,
      ${ratioOfSums("mps.kills", "mps.deaths")} AS avg_kd
    FROM match_player_stats mps
    JOIN matches m ON m.id = mps.match_id
    JOIN match_maps mm ON mm.id = mps.map_id
    WHERE m.season_id = ${seasonId}
      AND m.status = 'finished'
      AND mps.verified_by_admin IS NOT NULL
      AND mps.user_id IS NOT NULL
      ${userFilter}
    GROUP BY mps.user_id
  `);

  return new Map(
    (result.rows as unknown as VerifiedPlayerStatsRow[]).map((row) => [
      row.user_id,
      {
        maps: Number(row.maps),
        avgRating: row.avg_rating == null ? null : Number(row.avg_rating),
        avgAdr: row.avg_adr == null ? null : Number(row.avg_adr),
        avgKd: row.avg_kd == null ? null : Number(row.avg_kd),
      },
    ]),
  );
}

/** Historical player-map experience: samples are player-map observations, not team W/L. */
export async function getPublicPlayerMapExperience(userIds: readonly string[]) {
  if (!userIds.length) return [];
  const result = await db.execute(sql`
    SELECT mm.map_name, count(*)::int AS samples, count(distinct mps.user_id)::int AS players,
      ${simpleAvg("mps.rating_pro")} AS rating, ${roundWeightedAvg("mps.adr")} AS adr,
      ${ratioOfSums("mps.kills", "mps.deaths")} AS kd
    FROM match_player_stats mps
    JOIN matches m ON m.id = mps.match_id
    JOIN match_maps mm ON mm.id = mps.map_id
    JOIN seasons s ON s.id = m.season_id
    WHERE m.status = 'finished' AND s.status <> 'draft'
      AND mps.verified_by_admin IS NOT NULL
      AND mps.user_id IN (${sql.join([...new Set(userIds)].map((id) => sql`${id}`), sql`, `)})
    GROUP BY mm.map_name ORDER BY count(*) DESC, mm.map_name
  `);
  return (result.rows as unknown as { map_name: string; samples: number; players: number; rating: number | null; adr: number | null; kd: number | null }[]).map((row) => ({
    mapName: row.map_name, samples: Number(row.samples), players: Number(row.players),
    rating: row.rating === null ? null : Number(row.rating), adr: row.adr === null ? null : Number(row.adr), kd: row.kd === null ? null : Number(row.kd),
  }));
}

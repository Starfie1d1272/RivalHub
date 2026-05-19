import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { sql } from "drizzle-orm";
import { StatsLeaderboard } from "@/components/matches/StatsLeaderboard";
import { Marker } from "@/components/rivalhub";
import type { Metadata } from "next";

interface StatsPageProps {
  params: Promise<{ seasonSlug: string }>;
  searchParams: Promise<{ sort?: string; position?: string }>;
}

export async function generateMetadata({ params }: StatsPageProps): Promise<Metadata> {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  return {
    title: season ? `${season.name} · 数据统计` : "数据统计",
  };
}

export default async function StatsPage({ params, searchParams }: StatsPageProps) {
  const { seasonSlug } = await params;
  const { sort = "rating", position = "" } = await searchParams;

  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  const sortColumn = (() => {
    switch (sort) {
      case "adr":    return sql`avg(mps.adr)`;
      case "kd":     return sql`CASE WHEN sum(mps.deaths) > 0 THEN sum(mps.kills)::numeric / sum(mps.deaths) ELSE 0 END`;
      case "kpr":    return sql`sum(mps.kills)::numeric / count(*)`;
      case "hs":     return sql`avg(mps.hs_percent)`;
      case "we":     return sql`avg(mps.we)`;
      case "rws":    return sql`avg(mps.rws)`;
      case "fk":     return sql`sum(mps.first_kills)::numeric / count(*)`;
      case "clutch": return sql`sum(mps.clutches)::numeric / count(*)`;
      case "maps":   return sql`count(*)`;
      default:       return sql`avg(mps.rating_pro)`;
    }
  })();

  // 修复：使用原始字符串 sr.primary_position 而非 Drizzle schema 对象（展开后为表名，与别名 sr 冲突）
  const positionFilter = position
    ? sql`AND sr.primary_position = ${position}`
    : sql``;

  const { rows } = await db.execute(sql`
    SELECT
      mps.user_id,
      mps.perfect_name,
      sr.primary_position,
      t.name  AS team_name,
      t.id    AS team_id,
      count(*)::int                                                          AS maps,
      round(avg(mps.rating_pro)::numeric, 2)                                AS avg_rating,
      round(avg(mps.adr)::numeric, 1)                                       AS avg_adr,
      round(avg(mps.rws)::numeric, 2)                                       AS avg_rws,
      round(avg(mps.we)::numeric, 1)                                        AS avg_we,
      round(avg(mps.hs_percent)::numeric, 1)                                AS avg_hs,
      CASE WHEN sum(mps.deaths) > 0
        THEN round(sum(mps.kills)::numeric / sum(mps.deaths), 2)
        ELSE NULL END                                                        AS kd_ratio,
      round(sum(mps.kills)::numeric    / count(*), 2)                       AS kpr,
      round(sum(mps.first_kills)::numeric / count(*), 2)                    AS avg_fk,
      round(sum(mps.clutches)::numeric    / count(*), 2)                    AS avg_clutch
    FROM match_player_stats mps
    JOIN matches m ON m.id = mps.match_id
    LEFT JOIN season_registrations sr
      ON sr.user_id = mps.user_id AND sr.season_id = m.season_id
    LEFT JOIN team_members tm ON tm.registration_id = sr.id
    LEFT JOIN teams t ON t.id = tm.team_id
    WHERE m.season_id = ${season.id}
      AND mps.verified_by_admin IS NOT NULL
      ${positionFilter}
    GROUP BY mps.user_id, mps.perfect_name, sr.primary_position, t.name, t.id
    HAVING count(*) >= 3
    ORDER BY ${sortColumn} DESC
    LIMIT 100
  `);

  const toNum = (v: unknown) => (v == null ? 0 : Number(v));
  const toNumOrNull = (v: unknown) => (v == null ? null : Number(v));

  const leaderboardRows = rows.map((r) => ({
    userId:     r.user_id as string | null,
    perfectName: r.perfect_name as string,
    position:   r.primary_position as string | null,
    teamName:   r.team_name as string | null,
    teamId:     r.team_id as string | null,
    maps:       toNum(r.maps),
    avgRating:  toNum(r.avg_rating),
    avgAdr:     toNum(r.avg_adr),
    avgRws:     toNum(r.avg_rws),
    avgWe:      toNum(r.avg_we),
    avgHs:      toNum(r.avg_hs),
    kdRatio:    toNumOrNull(r.kd_ratio),
    kpr:        toNum(r.kpr),
    avgFk:      toNum(r.avg_fk),
    avgClutch:  toNum(r.avg_clutch),
  }));

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl space-y-6">
      <Marker sub={season.name + " · 最少 3 图"}>赛季排行榜</Marker>
      <StatsLeaderboard
        rows={leaderboardRows}
        sort={sort}
        position={position}
        seasonSlug={seasonSlug}
      />
    </div>
  );
}

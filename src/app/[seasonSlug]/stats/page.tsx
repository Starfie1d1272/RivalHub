import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { matchPlayerStats } from "@/db/schema/player-stats";
import { seasonRegistrations } from "@/db/schema/registrations";
import { teamMembers } from "@/db/schema/teams";
import { teams } from "@/db/schema/teams";
import { sql } from "drizzle-orm";
import { StatsLeaderboard } from "@/components/matches/StatsLeaderboard";
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
      case "adr": return sql`avg(${matchPlayerStats.adr})`;
      case "kd": return sql`CASE WHEN sum(${matchPlayerStats.deaths}) > 0 THEN round((sum(${matchPlayerStats.kills}) / sum(${matchPlayerStats.deaths}))::numeric, 2) ELSE 0 END`;
      case "we": return sql`avg(${matchPlayerStats.we})`;
      case "kpr": return sql`round((sum(${matchPlayerStats.kills}) / count(*))::numeric, 1)`;
      case "maps": return sql`count(*)`;
      default: return sql`avg(${matchPlayerStats.ratingPro})`;
    }
  })();

  const positionFilter = position
    ? sql`AND ${seasonRegistrations.primaryPosition} = ${position}`
    : sql``;

  const rows = await db.execute(sql`
    SELECT
      mps.user_id,
      mps.perfect_name,
      sr.primary_position,
      t.name as team_name,
      t.id as team_id,
      count(*)::int as maps,
      round(avg(mps.rating_pro)::numeric, 2) as avg_rating,
      round(avg(mps.adr)::numeric, 1) as avg_adr,
      round(avg(mps.kills)::numeric, 1) as avg_kills,
      round(avg(mps.deaths)::numeric, 1) as avg_deaths,
      round(avg(mps.we)::numeric, 1) as avg_we,
      sum(mps.kills)::int as total_kills,
      sum(mps.deaths)::int as total_deaths
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

  const leaderboardRows = (rows as unknown as Record<string, unknown>[]).map((r) => ({
    userId: r.user_id as string | null,
    perfectName: r.perfect_name as string,
    position: r.primary_position as string | null,
    teamName: r.team_name as string | null,
    teamId: r.team_id as string | null,
    maps: r.maps as number,
    avgRating: r.avg_rating as number,
    avgAdr: r.avg_adr as number,
    avgKills: r.avg_kills as number,
    avgDeaths: r.avg_deaths as number,
    avgWe: r.avg_we as number,
  }));

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">
          赛季排行榜
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          {season.name} · 最少 3 图
        </p>
      </div>
      <StatsLeaderboard
        rows={leaderboardRows}
        sort={sort}
        position={position}
        seasonSlug={seasonSlug}
      />
    </div>
  );
}

import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { sql } from "drizzle-orm";
import { StatsLeaderboard } from "@/components/matches/StatsLeaderboard";
import { normalizeLeaderboardState } from "@/lib/matches/leaderboard-view";
import { Marker } from "@/components/rivalhub";
import { roundWeightedAvg, killWeightedAvg, perRound, roundsExpr } from "@/lib/stats";
import { normalizeStagePlan } from "@/types/season";
import type { Metadata } from "next";

interface StatsPageProps {
  params: Promise<{ seasonSlug: string }>;
  searchParams: Promise<{ sort?: string; position?: string; view?: string; stage?: string }>;
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
  const { sort: rawSort, position = "", view: rawView, stage = "" } = await searchParams;
  const { sort, view } = normalizeLeaderboardState({ sort: rawSort, view: rawView });

  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();

  const stages = normalizeStagePlan(season.stagePlan).map((s) => ({ key: s.key, name: s.name }));

  // 各指标的聚合表达式（sortColumn 和 SELECT 共用）
  // ADR：回合加权（正确方式）；HS%：击杀数加权（正确方式）
  const adrExpr    = roundWeightedAvg("mps.adr");
  const hsExpr     = killWeightedAvg("mps.hs_percent");
  const kprExpr    = perRound("mps.kills");
  const fkprExpr   = perRound("mps.first_kills");
  const mkprExpr   = perRound("mps.multi_kills");
  const cprExpr    = perRound("mps.clutches");
  // roundsExpr 导出供 HAVING/ORDER 等场景直接使用（此处暂不需要，保留 import 以备扩展）
  void roundsExpr;

  const sortColumn = (() => {
    switch (sort) {
      case "adr":    return adrExpr;
      case "kd":     return sql`CASE WHEN sum(mps.deaths) > 0 THEN sum(mps.kills)::numeric / sum(mps.deaths) ELSE NULL END`;
      case "kpr":    return kprExpr;
      case "hs":     return hsExpr;
      case "we":     return sql`avg(mps.we)`;
      case "rws":    return sql`avg(mps.rws)`;
      case "fk":     return fkprExpr;
      case "mk":     return mkprExpr;
      case "clutch": return cprExpr;
      case "maps":   return sql`count(*)`;
      default:       return sql`avg(mps.rating_pro)`;
    }
  })();

  const positionFilter = position ? sql`AND sr.primary_position = ${position}` : sql``;
  const stageFilter = stage ? sql`AND m.stage = ${stage}` : sql``;

  const { rows } = await db.execute(sql`
    SELECT
      mps.user_id,
      COALESCE(u.perfect_name, mps.perfect_name) AS perfect_name,
      sr.primary_position,
      t.name  AS team_name,
      t.id    AS team_id,
      count(*)::int                                                          AS maps,
      round(avg(mps.rating_pro)::numeric, 2)                                AS avg_rating,
      round(${adrExpr}::numeric, 1)                                         AS avg_adr,
      round(avg(mps.rws)::numeric, 2)                                       AS avg_rws,
      round(avg(mps.we)::numeric, 1)                                        AS avg_we,
      round(${hsExpr}::numeric, 1)                                          AS avg_hs,
      CASE WHEN sum(mps.deaths) > 0
        THEN round(sum(mps.kills)::numeric / sum(mps.deaths), 2)
        ELSE NULL END                                                        AS kd_ratio,
      round(${kprExpr}::numeric, 2)                                         AS kpr,
      round(${fkprExpr}::numeric, 4)                                        AS fkpr,
      round(${mkprExpr}::numeric, 4)                                        AS mkpr,
      round(${cprExpr}::numeric, 4)                                         AS cpr
    FROM match_player_stats mps
    JOIN matches m ON m.id = mps.match_id
    JOIN match_maps mm ON mm.id = mps.map_id
    LEFT JOIN users u ON u.id = mps.user_id
    LEFT JOIN season_registrations sr
      ON sr.user_id = mps.user_id AND sr.season_id = m.season_id
    LEFT JOIN team_members tm
      ON tm.user_id = mps.user_id AND tm.season_id = m.season_id
    LEFT JOIN teams t ON t.id = tm.team_id
    WHERE m.season_id = ${season.id}
      AND mps.verified_by_admin IS NOT NULL
      AND mps.source = 'manual_ocr'
      ${positionFilter}
      ${stageFilter}
    GROUP BY mps.user_id, COALESCE(u.perfect_name, mps.perfect_name), sr.primary_position, t.name, t.id
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
    fkpr:       toNum(r.fkpr),
    mkpr:       toNum(r.mkpr),
    cpr:        toNum(r.cpr),
  }));

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl space-y-6">
      <Marker sub={season.name}>赛季排行榜</Marker>
      <StatsLeaderboard
        rows={leaderboardRows}
        sort={sort}
        position={position}
        seasonSlug={seasonSlug}
        view={view}
        stages={stages}
        currentStage={stage}
      />
    </div>
  );
}

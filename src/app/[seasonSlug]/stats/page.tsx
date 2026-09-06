import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { StatsLeaderboard } from "@/components/matches/StatsLeaderboard";
import { normalizeLeaderboardState } from "@/lib/matches/leaderboard-view";
import { PageHeader, PageLayout } from "@/components/rivalhub";
import {
  killWeightedAvg,
  perRound,
  ratioOfSums,
  roundWeightedAvg,
  simpleAvg,
} from "@/lib/stats";
import { normalizeStagePlan } from "@/types/season";
import type { Metadata } from "next";
import { getPublicOrAuthorizedDraftSeason, getPublicSeasonBySlug } from "@/lib/data/public-seasons";

interface StatsPageProps {
  params: Promise<{ seasonSlug: string }>;
  searchParams: Promise<{ sort?: string; position?: string; view?: string; stage?: string }>;
}

export async function generateMetadata({ params }: StatsPageProps): Promise<Metadata> {
  const { seasonSlug } = await params;
  const season = await getPublicSeasonBySlug(seasonSlug);
  return {
    title: season ? `${season.name} · 数据统计` : "数据统计",
  };
}

export default async function StatsPage({ params, searchParams }: StatsPageProps) {
  const { seasonSlug } = await params;
  const { sort: rawSort, position = "", view: rawView, stage = "" } = await searchParams;
  const { sort, view } = normalizeLeaderboardState({ sort: rawSort, view: rawView });

  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
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
  const ratingExpr = simpleAvg("mps.rating_pro");
  const rwsExpr    = simpleAvg("mps.rws");
  const weExpr     = simpleAvg("mps.we");
  const kdExpr     = ratioOfSums("mps.kills", "mps.deaths");

  const sortColumn = (() => {
    switch (sort) {
      case "adr":    return adrExpr;
      case "kd":     return kdExpr;
      case "kpr":    return kprExpr;
      case "hs":     return hsExpr;
      case "we":     return weExpr;
      case "rws":    return rwsExpr;
      case "fk":     return fkprExpr;
      case "mk":     return mkprExpr;
      case "clutch": return cprExpr;
      case "maps":   return sql`count(*)`;
      default:       return ratingExpr;
    }
  })();

  const positionFilter = position ? sql`AND sr.primary_position = ${position}` : sql``;
  const stageFilter = stage ? sql`AND m.stage = ${stage}` : sql``;

  const { rows } = await db.execute(sql`
    SELECT
      mps.user_id,
      COALESCE(u.perfect_name, mps.perfect_name) AS perfect_name,
      sr.primary_position,
      entrant.name  AS team_name,
      entrant.id    AS team_id,
      count(*)::int                                                          AS maps,
      ${ratingExpr}                                                          AS avg_rating,
      ${adrExpr}                                                             AS avg_adr,
      ${rwsExpr}                                                             AS avg_rws,
      ${weExpr}                                                              AS avg_we,
      ${hsExpr}                                                              AS avg_hs,
      ${kdExpr}                                                              AS kd_ratio,
      ${kprExpr}                                                             AS kpr,
      ${fkprExpr}                                                            AS fkpr,
      ${mkprExpr}                                                             AS mkpr,
      ${cprExpr}                                                             AS cpr
    FROM match_player_stats mps
    JOIN matches m ON m.id = mps.match_id
    JOIN match_maps mm ON mm.id = mps.map_id
    LEFT JOIN users u ON u.id = mps.user_id
    LEFT JOIN season_registrations sr
      ON sr.user_id = mps.user_id AND sr.season_id = m.season_id
    LEFT JOIN LATERAL (
      SELECT ce.id, ce.name
      FROM event_roster_members erm
      INNER JOIN event_rosters er ON er.id = erm.event_roster_id
      INNER JOIN competition_entries ce ON ce.id = er.entry_id
      WHERE erm.user_id = mps.user_id
        AND ce.competition_id = m.season_id
        AND ce.id IN (m.entry_a_id, m.entry_b_id)
      LIMIT 1
    ) entrant ON true
    WHERE m.season_id = ${season.id}
      AND mps.verified_by_admin IS NOT NULL
      ${positionFilter}
      ${stageFilter}
    GROUP BY mps.user_id, COALESCE(u.perfect_name, mps.perfect_name), sr.primary_position, entrant.name, entrant.id
    ORDER BY ${sortColumn} DESC NULLS LAST, COALESCE(u.perfect_name, mps.perfect_name) ASC
    LIMIT 100
  `);

  const toNumOrNull = (v: unknown) => (v == null ? null : Number(v));

  const leaderboardRows = rows.map((r) => ({
    userId:     r.user_id as string | null,
    perfectName: r.perfect_name as string,
    position:   r.primary_position as string | null,
    teamName:   r.team_name as string | null,
    teamId:     r.team_id as string | null,
    maps:       Number(r.maps),
    avgRating:  toNumOrNull(r.avg_rating),
    avgAdr:     toNumOrNull(r.avg_adr),
    avgRws:     toNumOrNull(r.avg_rws),
    avgWe:      toNumOrNull(r.avg_we),
    avgHs:      toNumOrNull(r.avg_hs),
    kdRatio:    toNumOrNull(r.kd_ratio),
    kpr:        toNumOrNull(r.kpr),
    fkpr:       toNumOrNull(r.fkpr),
    mkpr:       toNumOrNull(r.mkpr),
    cpr:        toNumOrNull(r.cpr),
  }));

  return (
    <PageLayout as="div" variant="standard" className="space-y-6">
      <PageHeader title="赛季排行榜" eyebrow={season.name} />
      <StatsLeaderboard
        rows={leaderboardRows}
        sort={sort}
        position={position}
        seasonSlug={seasonSlug}
        view={view}
        stages={stages}
        currentStage={stage}
      />
    </PageLayout>
  );
}

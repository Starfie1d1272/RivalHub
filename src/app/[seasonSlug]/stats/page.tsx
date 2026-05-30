import { notFound } from "next/navigation";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, playerRatings } from "@/db/schema";
import { sql } from "drizzle-orm";
import { StatsLeaderboard } from "@/components/matches/StatsLeaderboard";
import { WeaponLeaderboard } from "@/components/matches/WeaponLeaderboard";
import { HighlightLeaderboard } from "@/components/matches/HighlightLeaderboard";
import { normalizeLeaderboardState } from "@/lib/matches/leaderboard-view";
import { Marker } from "@/components/rivalhub";
import { roundWeightedAvg, killWeightedAvg, perRound, roundsExpr, ocrFallbackCte } from "@/lib/stats";
import { normalizeStagePlan } from "@/types/season";
import { getSeasonDemoStats, getSeasonWeaponStats, getSeasonHighlightStats, type DemoLeaderboardData } from "@/actions/season-demo-stats";
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

  const stagePlan = normalizeStagePlan(season.stagePlan);
  const stages = Array.isArray(stagePlan) ? stagePlan.map((s) => ({ key: s.key, name: s.name })) : [];

  // Demo 源进阶榜单数据（异步获取，仅在 view=demo 时使用）
  const demoResult = await getSeasonDemoStats(season.id);
  const demoStats = demoResult.success ? demoResult.data : [];
  const hasDemoData = demoStats.length > 0;

  // 武器/AWP 击杀榜
  const weaponResult = await getSeasonWeaponStats(season.id);
  const weaponStats = weaponResult.success ? weaponResult.data : [];

  // 高光榜（collateral/wallbang/noScope）
  const highlightResult = await getSeasonHighlightStats(season.id);
  const highlightStats = highlightResult.success ? highlightResult.data : [];

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
      case "we":     return sql`COALESCE(avg(mps.we), min(ocr.avg_we_ocr))`;
      case "rws":    return sql`COALESCE(avg(mps.rws), min(ocr.avg_rws_ocr))`;
      case "fk":     return fkprExpr;
      case "mk":     return mkprExpr;
      case "clutch": return cprExpr;
      case "maps":   return sql`count(*)`;
      case "rr":     return sql`(SELECT rr_score FROM player_ratings WHERE season_id = ${season.id} AND user_id = mps.user_id LIMIT 1)`;
      default:       return sql`COALESCE(avg(mps.rating_pro), min(ocr.avg_rating_ocr))`;
    }
  })();

  const positionFilter = position ? sql`AND sr.primary_position = ${position}` : sql``;
  const stageFilter = stage ? sql`AND m.stage = ${stage}` : sql``;

  const { rows } = await db.execute(sql`
    WITH ocr_avg AS (${ocrFallbackCte(sql`${season.id}`)})
    SELECT
      mps.user_id,
      COALESCE(u.perfect_name, mps.perfect_name) AS perfect_name,
      sr.primary_position,
      t.name  AS team_name,
      t.id    AS team_id,
      count(*)::int                                                          AS maps,
      COALESCE(round(avg(mps.rating_pro)::numeric, 2), min(ocr.avg_rating_ocr))  AS avg_rating,
      round(${adrExpr}::numeric, 1)                                         AS avg_adr,
      COALESCE(round(avg(mps.rws)::numeric, 2), min(ocr.avg_rws_ocr))           AS avg_rws,
      COALESCE(round(avg(mps.we)::numeric, 1), min(ocr.avg_we_ocr))             AS avg_we,
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
    LEFT JOIN team_members tm ON tm.registration_id = sr.id
    LEFT JOIN teams t ON t.id = tm.team_id
    LEFT JOIN ocr_avg ocr ON ocr.user_id = mps.user_id
    WHERE m.season_id = ${season.id}
      AND mps.verified_by_admin IS NOT NULL
      AND mps.source = COALESCE(mm.active_stat_source, 'manual_ocr'::stat_source)
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

  // 查询 RR 评分（from player_ratings）
  const userIds = leaderboardRows.map((r) => r.userId).filter((id): id is string => id != null);
  const rrMap = new Map<string, number | null>();
  if (userIds.length > 0) {
    const rrRows = await db
      .select({ userId: playerRatings.userId, rrScore: playerRatings.rrScore })
      .from(playerRatings)
      .where(and(eq(playerRatings.seasonId, season.id), inArray(playerRatings.userId, userIds)));
    for (const r of rrRows) {
      if (r.userId) rrMap.set(r.userId, r.rrScore != null ? Number(r.rrScore) : null);
    }
  }

  // 将 Demo 源数据 merge 进 leaderboardRows（按 userId 匹配）
  const demoMap = new Map<string, DemoLeaderboardData>();
  for (const d of demoStats) {
    if (d.userId) demoMap.set(d.userId, d);
  }
  const allMergedRows = leaderboardRows.map((r) => {
    const demo = r.userId ? demoMap.get(r.userId) : undefined;
    const rrScore = r.userId != null ? (rrMap.get(r.userId) ?? null) : null;
    const base = { ...r, rrScore };
    if (!demo) return base;
    return {
      ...base,
      avgDemoKast: demo.kast ?? undefined,
      avgDemoAdr: demo.adr ?? undefined,
      demoFkpr: demo.fkpr,
      demoClutchWinRate: demo.clutchWinRate ?? 0,
      demoUtilityPerRound: demo.avgUtilityDamagePerRound ?? 0,
      vsOneWinRate: demo.vsOneWinRate,
      twoKillCount: demo.twoKillCount,
      threeKillCount: demo.threeKillCount,
      fourKillCount: demo.fourKillCount,
      fiveKillCount: demo.fiveKillCount,
      entrySuccessRate: demo.entrySuccessRate ?? undefined,
      awpKillRate: demo.awpKillRate ?? undefined,
    };
  });
  const mergedRows = allMergedRows.filter((r) => r.userId != null);

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl space-y-6">
      <Marker sub={season.name}>赛季排行榜</Marker>
      <StatsLeaderboard
        rows={mergedRows}
        sort={sort}
        position={position}
        seasonSlug={seasonSlug}
        view={view}
        stages={stages}
        currentStage={stage}
        hasDemoData={hasDemoData}
      />
      {weaponStats.length > 0 && (
        <WeaponLeaderboard players={weaponStats} seasonSlug={seasonSlug} />
      )}
      {highlightStats.length > 0 && (
        <HighlightLeaderboard highlights={highlightStats} seasonSlug={seasonSlug} />
      )}
    </div>
  );
}

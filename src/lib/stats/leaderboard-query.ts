import "server-only";

import { db, type DB, type TxDb } from "@/db/client";
import { sql } from "drizzle-orm";
import type { EffectiveMatchRosterPlayer } from "@/lib/match-rosters/effective";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { completeSum, killWeightedAvg, perRound, ratioOfSums, roundWeightedAvg, roundsExpr, simpleAvg } from "./sql";

export interface StatsLeaderboardFilters {
  seasonId?: string;
  stage?: string;
  format?: "bo1" | "bo3" | "bo5";
  mapFilter?: string;
  teamFilter?: string;
}

export interface StatsLeaderboardOptions {
  userId?: string;
  groupByMap?: boolean;
  groupByTeam?: boolean;
  requireCurrentImports?: boolean;
}

export async function getStatsLeaderboard(
  scope: StatsLeaderboardFilters,
  currentImportIds: string[],
  roster: EffectiveMatchRosterPlayer[],
  database: DB | TxDb = db,
  options: StatsLeaderboardOptions = {},
) {
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

  const mapFilter = scope.mapFilter ? sql`AND mm.map_name = ${scope.mapFilter}` : sql``;
  const teamFilter = scope.teamFilter ? sql`AND entrant.id = ${scope.teamFilter}` : sql``;
  const userFilter = options.userId ? sql`AND mps.user_id = ${options.userId}` : sql``;
  const currentImportFilter = currentImportIds.length ? sql`mps.dak_import_id IN (${sql.join(currentImportIds.map((id) => sql`${id}`), sql`, `)})` : sql`false`;
  const importFilter = options.requireCurrentImports
    ? currentImportFilter
    : sql`(mps.dak_import_id IS NULL OR ${currentImportFilter})`;
  const seasonFilter = scope.seasonId ? sql`AND m.season_id = ${scope.seasonId}` : sql``;
  const stageFilter = scope.stage ? sql`AND m.stage = ${scope.stage}` : sql``;
  const formatFilter = scope.format ? sql`AND m.format = ${scope.format}` : sql``;
  const mapName = options.groupByMap ? sql`mm.map_name AS map_name,` : sql`NULL::text AS map_name,`;
  const mapGroup = options.groupByMap ? sql`, mm.map_name` : sql``;
  const teamColumns = options.groupByTeam === false
    ? sql`string_agg(DISTINCT entrant.name, ' · ') AS team_name, NULL::uuid AS team_id,`
    : sql`entrant.name AS team_name, entrant.id AS team_id,`;
  const teamGroup = options.groupByTeam === false ? sql`` : sql`, entrant.name, entrant.id`;
  const teamOrder = options.groupByTeam === false ? sql`` : sql`, entrant.id`;

  const { rows } = await database.execute(sql`
    SELECT
      mps.user_id,
      u.display_name, sp.persona_name, u.perfect_name,
      ${teamColumns}
      ${mapName}
      count(*)::int                                                          AS maps,
      count(mps.rating_pro)::int                                              AS rating_samples,
      ${completeSum(roundsExpr)}                                              AS rounds,
      ${ratingExpr}                                                          AS avg_rating,
      ${adrExpr}                                                             AS avg_adr,
      ${rwsExpr}                                                             AS avg_rws,
      ${weExpr}                                                              AS avg_we,
      ${hsExpr}                                                              AS avg_hs,
      ${kdExpr}                                                              AS kd_ratio,
      ${kprExpr}                                                             AS kpr,
      ${fkprExpr}                                                            AS fkpr,
      ${mkprExpr}                                                             AS mkpr,
      ${cprExpr} AS cpr,
      ${perRound("mps.first_deaths")} AS fdpr,
      ${perRound("mps.trade_kills")} AS trade_kpr,
      ${perRound("mps.kast_rounds")} AS kast
    FROM match_player_stats mps
    JOIN matches m ON m.id = mps.match_id
    JOIN match_maps mm ON mm.id = mps.map_id
    LEFT JOIN users u ON u.id = mps.user_id
    LEFT JOIN steam_profiles sp ON sp.steam64 = u.steam64
    LEFT JOIN jsonb_to_recordset(${JSON.stringify(roster.map((row) => ({ match_id: row.matchId, user_id: row.userId, entry_id: row.entryId })))}::jsonb)
      AS lineup(match_id uuid, user_id uuid, entry_id uuid)
      ON lineup.match_id = m.id AND lineup.user_id = mps.user_id
    LEFT JOIN competition_entries entrant ON entrant.id = lineup.entry_id
    WHERE true
      ${seasonFilter}
      AND mps.verified_by_admin IS NOT NULL
      AND m.status = 'finished'
      AND mps.user_id IS NOT NULL
      AND ${importFilter}
      ${stageFilter}
      ${formatFilter}
      ${mapFilter}
      ${teamFilter}
      ${userFilter}
    GROUP BY mps.user_id, u.display_name, sp.persona_name, u.perfect_name ${teamGroup} ${mapGroup}
    ORDER BY mps.user_id ${teamOrder} ${options.groupByMap ? sql`, mm.map_name` : sql``}
  `);

  const toNumOrNull = (v: unknown) => (v == null ? null : Number(v));

  return rows.map((r) => ({
    mapName: r.map_name as string | null,
    userId:     r.user_id as string | null,
    perfectName: getPublicDisplayName({ displayName: r.display_name as string | null, personaName: r.persona_name as string | null, perfectName: r.perfect_name as string | null }),
    teamName:   r.team_name as string | null,
    teamId:     r.team_id as string | null,
    maps:       Number(r.maps),
    ratingSamples: Number(r.rating_samples),
    rounds:     toNumOrNull(r.rounds),
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
    fdpr: toNumOrNull(r.fdpr), tradeKpr: toNumOrNull(r.trade_kpr), kast: toNumOrNull(r.kast),
  }));

}

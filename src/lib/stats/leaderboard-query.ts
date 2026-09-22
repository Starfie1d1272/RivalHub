import "server-only";

import { db, type DB, type TxDb } from "@/db/client";
import { sql } from "drizzle-orm";
import type { EffectiveMatchRosterPlayer } from "@/lib/match-rosters/effective";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { killWeightedAvg, perRound, ratioOfSums, roundWeightedAvg, simpleAvg } from "./sql";

export async function getStatsLeaderboard(seasonId: string, stage: string, map: string, team: string, currentImportIds: string[], roster: EffectiveMatchRosterPlayer[], database: DB | TxDb = db) {
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

  const mapFilter = map ? sql`AND mm.map_name = ${map}` : sql``;
  const teamFilter = team ? sql`AND entrant.id = ${team}` : sql``;
  const importFilter = currentImportIds.length ? sql`mps.dak_import_id IN (${sql.join(currentImportIds.map((id) => sql`${id}`), sql`, `)})` : sql`false`;
  const stageFilter = stage ? sql`AND m.stage = ${stage}` : sql``;

  const { rows } = await database.execute(sql`
    SELECT
      mps.user_id,
      u.display_name, sp.persona_name, u.perfect_name,
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
    WHERE m.season_id = ${seasonId}
      AND mps.verified_by_admin IS NOT NULL
      AND m.status = 'finished'
      AND mps.user_id IS NOT NULL
      AND (mps.dak_import_id IS NULL OR ${importFilter})
      ${stageFilter}
      ${mapFilter}
      ${teamFilter}
    GROUP BY mps.user_id, u.display_name, sp.persona_name, u.perfect_name, entrant.name, entrant.id
    ORDER BY mps.user_id, entrant.id
  `);

  const toNumOrNull = (v: unknown) => (v == null ? null : Number(v));

  return rows.map((r) => ({
    userId:     r.user_id as string | null,
    perfectName: getPublicDisplayName({ displayName: r.display_name as string | null, personaName: r.persona_name as string | null, perfectName: r.perfect_name as string | null }),
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
    fdpr: toNumOrNull(r.fdpr), tradeKpr: toNumOrNull(r.trade_kpr), kast: toNumOrNull(r.kast),
  }));

}

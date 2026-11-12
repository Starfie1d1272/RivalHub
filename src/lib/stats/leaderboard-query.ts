import "server-only";

import { db, type DB, type TxDb } from "@/db/client";
import { sql } from "drizzle-orm";
import {
  effectiveMatchRosterIdentitiesQuery,
  type EffectiveMatchRosterIdentity,
} from "@/lib/match-rosters/effective";
import { lineupPopulationState } from "@/db/schema";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { getCurrentStatsSelectionInTx } from "./tournament-scope";
import {
  completeSum,
  killWeightedAvg,
  killWeightedDenominator,
  perRound,
  perRoundDenominator,
  ratioOfSums,
  roundWeightedAvg,
  roundsExpr,
  simpleAvg,
} from "./sql";

export interface StatsLeaderboardFilters {
  seasonId?: string;
  matchIds?: readonly string[];
  stage?: string;
  format?: "bo1" | "bo3" | "bo5";
  mapFilter?: string;
  teamFilter?: string;
  teamSelections?: readonly { teamId: string; importIds: readonly string[] }[];
}

export interface StatsLeaderboardOptions {
  userId?: string;
  groupByMap?: boolean;
  groupByTeam?: boolean;
  requireCurrentImports?: boolean;
  requireRosterMatch?: boolean;
  includeTestMatch?: boolean;
}

export async function getStatsLeaderboard(
  scope: StatsLeaderboardFilters,
  currentImportIds: string[],
  roster: readonly Pick<EffectiveMatchRosterIdentity, "matchId" | "userId" | "entryId">[],
  database: DB | TxDb = db,
  options: StatsLeaderboardOptions = {},
) {
  return (await queryStatsLeaderboard(scope, currentImportIds, roster, database, options)).rows;
}

/** Overall and per-map rows share the exact weighted expressions and fact filters. */
export async function getPlayerStatsScoreboards(
  scope: StatsLeaderboardFilters,
  currentImportIds: string[],
  roster: readonly Pick<EffectiveMatchRosterIdentity, "matchId" | "userId" | "entryId">[],
  database: DB | TxDb,
  options: Omit<StatsLeaderboardOptions, "groupByMap" | "groupByTeam"> & { userId: string },
) {
  const result = await queryStatsLeaderboard(
    scope,
    currentImportIds,
    roster,
    database,
    { ...options, groupByMap: true, groupByTeam: false },
    true,
  );
  return {
    scoreboard: result.rows.filter((_, index) => result.overall[index]),
    scoreboardMaps: result.rows.filter((_, index) => !result.overall[index]),
  };
}

async function queryStatsLeaderboard(
  scope: StatsLeaderboardFilters,
  currentImportIds: string[],
  roster: readonly Pick<EffectiveMatchRosterIdentity, "matchId" | "userId" | "entryId">[],
  database: DB | TxDb = db,
  options: StatsLeaderboardOptions = {},
  includeOverall = false,
) {
  const query = buildStatsLeaderboardQuery(
    scope,
    currentImportIds,
    roster,
    options,
    includeOverall,
  );
  const { rows } = await database.execute(query);

  const toNumOrNull = (v: unknown) => (v == null ? null : Number(v));

  const projectedRows = rows.map((r) => ({
    mapName: r.map_name as string | null,
    userId: r.user_id as string | null,
    perfectName: getPublicDisplayName({
      displayName: r.display_name as string | null,
      personaName: r.persona_name as string | null,
      perfectName: r.perfect_name as string | null,
    }),
    teamName: r.team_name as string | null,
    teamId: r.team_id as string | null,
    ...(options.groupByTeam === false ? { teamIds: (r.team_ids as string[] | null) ?? [] } : {}),
    maps: Number(r.maps),
    ratingSamples: Number(r.rating_samples),
    adrRounds: toNumOrNull(r.adr_rounds),
    scoreboardSamples: {
      kprRounds: toNumOrNull(r.kpr_rounds),
      fkprRounds: toNumOrNull(r.fkpr_rounds),
      mkprRounds: toNumOrNull(r.mkpr_rounds),
      cprRounds: toNumOrNull(r.cpr_rounds),
      fdprRounds: toNumOrNull(r.fdpr_rounds),
      tradeKprRounds: toNumOrNull(r.trade_kpr_rounds),
      kastRounds: toNumOrNull(r.kast_rounds_sample),
      hsKills: toNumOrNull(r.hs_kills),
      kdDeaths: toNumOrNull(r.kd_deaths),
    },
    rounds: toNumOrNull(r.rounds),
    avgRating: toNumOrNull(r.avg_rating),
    avgAdr: toNumOrNull(r.avg_adr),
    avgRws: toNumOrNull(r.avg_rws),
    avgWe: toNumOrNull(r.avg_we),
    avgHs: toNumOrNull(r.avg_hs),
    kdRatio: toNumOrNull(r.kd_ratio),
    kpr: toNumOrNull(r.kpr),
    fkpr: toNumOrNull(r.fkpr),
    mkpr: toNumOrNull(r.mkpr),
    cpr: toNumOrNull(r.cpr),
    fdpr: toNumOrNull(r.fdpr),
    tradeKpr: toNumOrNull(r.trade_kpr),
    kast: toNumOrNull(r.kast),
  }));

  return { rows: projectedRows, overall: rows.map((row) => Number(row.map_grouping) === 1) };
}

function buildStatsLeaderboardQuery(
  scope: StatsLeaderboardFilters,
  currentImportIds: string[],
  roster: readonly Pick<EffectiveMatchRosterIdentity, "matchId" | "userId" | "entryId">[],
  options: StatsLeaderboardOptions,
  includeOverall = false,
) {
  // ADR：回合加权（正确方式）；HS%：击杀数加权（正确方式）
  const adrExpr = roundWeightedAvg("mps.adr");
  const hsExpr = killWeightedAvg("mps.hs_percent");
  const kprExpr = perRound("mps.kills");
  const fkprExpr = perRound("mps.first_kills");
  const mkprExpr = perRound("mps.multi_kills");
  const cprExpr = perRound("mps.clutches");
  const ratingExpr = simpleAvg("mps.rating_pro");
  const rwsExpr = simpleAvg("mps.rws");
  const weExpr = simpleAvg("mps.we");
  const kdExpr = ratioOfSums("mps.kills", "mps.deaths");

  const mapFilter = scope.mapFilter ? sql`AND mm.map_name = ${scope.mapFilter}` : sql``;
  const teamFilter = scope.teamSelections
    ? scope.teamSelections.length
      ? sql`AND (${sql.join(
          scope.teamSelections.map(
            ({ teamId, importIds }) => sql`
    (entrant.id = ${teamId} AND entrant.id IN (m.entry_a_id, m.entry_b_id) AND (mps.dak_import_id IS NULL OR ${
      importIds.length
        ? sql`mps.dak_import_id IN (${sql.join(
            importIds.map((id) => sql`${id}`),
            sql`, `,
          )})`
        : sql`false`
    }))`,
          ),
          sql` OR `,
        )})`
      : sql`AND false`
    : scope.teamFilter
      ? sql`AND entrant.id = ${scope.teamFilter}`
      : sql``;
  const userFilter = options.userId ? sql`AND mps.user_id = ${options.userId}` : sql``;
  const rosterMatchFilter = options.requireRosterMatch
    ? sql`AND lineup.entry_id IS NOT NULL`
    : sql``;
  const importFilter = scoreboardImportCondition(
    "mps",
    currentImportIds,
    options.requireCurrentImports,
  );
  const seasonFilter = scope.seasonId ? sql`AND m.season_id = ${scope.seasonId}` : sql``;
  const matchFilter = scope.matchIds
    ? scope.matchIds.length
      ? sql`AND m.id IN (${sql.join(
          scope.matchIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql`AND false`
    : sql``;
  const stageFilter = scope.stage ? sql`AND m.stage = ${scope.stage}` : sql``;
  const formatFilter = scope.format ? sql`AND m.format = ${scope.format}` : sql``;
  const mapName = options.groupByMap ? sql`mm.map_name AS map_name,` : sql`NULL::text AS map_name,`;
  const mapGroup = options.groupByMap ? sql`, mm.map_name` : sql``;
  const teamColumns =
    options.groupByTeam === false
      ? sql`string_agg(DISTINCT entrant.name, ' · ') AS team_name, NULL::uuid AS team_id, array_agg(DISTINCT entrant.id) AS team_ids,`
      : sql`entrant.name AS team_name, entrant.id AS team_id,`;
  const teamGroup = options.groupByTeam === false ? sql`` : sql`, entrant.name, entrant.id`;
  const teamOrder = options.groupByTeam === false ? sql`` : sql`, entrant.id`;

  const playerGroup = sql`mps.user_id, u.display_name, sp.persona_name, u.perfect_name ${teamGroup}`;
  const grouping = includeOverall
    ? sql`GROUPING SETS ((${playerGroup}), (${playerGroup}, mm.map_name))`
    : sql`${playerGroup} ${mapGroup}`;

  return sql`
    SELECT
      mps.user_id,
      u.display_name, sp.persona_name, u.perfect_name,
      ${teamColumns}
      ${mapName}
      ${includeOverall ? sql`GROUPING(mm.map_name)::int AS map_grouping,` : sql``}
      count(*)::int                                                          AS maps,
      count(mps.rating_pro)::int                                              AS rating_samples,
      sum(${roundsExpr}) FILTER (WHERE mps.adr IS NOT NULL AND ${roundsExpr} IS NOT NULL)::int AS adr_rounds,
      ${completeSum(roundsExpr)}                                              AS rounds,
      ${perRoundDenominator("mps.kills")}::int AS kpr_rounds,
      ${perRoundDenominator("mps.first_kills")}::int AS fkpr_rounds,
      ${perRoundDenominator("mps.multi_kills")}::int AS mkpr_rounds,
      ${perRoundDenominator("mps.clutches")}::int AS cpr_rounds,
      ${perRoundDenominator("mps.first_deaths")}::int AS fdpr_rounds,
      ${perRoundDenominator("mps.trade_kills")}::int AS trade_kpr_rounds,
      ${perRoundDenominator("mps.kast_rounds")}::int AS kast_rounds_sample,
      ${killWeightedDenominator("mps.hs_percent")}::int AS hs_kills,
      ${completeSum("mps.deaths")}::int AS kd_deaths,
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
    JOIN match_maps mm ON mm.id = mps.map_id AND mm.match_id = m.id
    LEFT JOIN users u ON u.id = mps.user_id
    LEFT JOIN steam_profiles sp ON sp.steam64 = u.steam64
    LEFT JOIN jsonb_to_recordset(${JSON.stringify(roster.map((row) => ({ match_id: row.matchId, user_id: row.userId, entry_id: row.entryId })))}::jsonb)
      AS lineup(match_id uuid, user_id uuid, entry_id uuid)
      ON lineup.match_id = m.id AND lineup.user_id = mps.user_id
    LEFT JOIN competition_entries entrant ON entrant.id = lineup.entry_id
    WHERE true
      ${options.includeTestMatch ? sql`` : sql`AND m.test_config IS NULL`}
      ${seasonFilter}
      ${matchFilter}
      AND mps.verified_by_admin IS NOT NULL
      AND mm.completed_at IS NOT NULL AND mm.score_a + mm.score_b > 0
      AND mps.user_id IS NOT NULL
      AND ${importFilter}
      AND ${unambiguousScoreboardRow(currentImportIds)}
      ${stageFilter}
      ${formatFilter}
      ${mapFilter}
      ${teamFilter}
      ${userFilter}
      ${rosterMatchFilter}
    GROUP BY ${grouping}
    ORDER BY mps.user_id ${teamOrder} ${options.groupByMap ? sql`, mm.map_name` : sql``}
  `;
}

function scoreboardImportCondition(
  alias: "mps" | "competing",
  currentImportIds: string[],
  requireCurrent = false,
) {
  const importId = sql`${sql.raw(alias)}.dak_import_id`;
  const current = currentImportIds.length
    ? sql`${importId} = ANY(${sql.param(currentImportIds)}::uuid[])`
    : sql`false`;
  return requireCurrent ? current : sql`(${importId} IS NULL OR ${current})`;
}

/** Same per-map ambiguity rule as the match scoreboard. */
function unambiguousScoreboardRow(currentImportIds: string[]) {
  return sql`NOT EXISTS (
    SELECT 1 FROM match_player_stats competing
    WHERE competing.map_id = mps.map_id
      AND competing.match_id = mps.match_id
      AND competing.user_id = mps.user_id
      AND competing.id <> mps.id
      AND competing.verified_by_admin IS NOT NULL
      AND ${scoreboardImportCondition("competing", currentImportIds)}
  )`;
}

export const LINEUP_POPULATION_CHANGED = "RIVALHUB_LINEUP_POPULATION_CHANGED";
export const lineupPopulationRevision = sql<
  string | null
>`(select ${lineupPopulationState.revision} from ${lineupPopulationState})`;

/** Keep selection and aggregation on one snapshot, including the historical cutoff. */
export async function getLineupStatsPopulation(
  excludeMatchId: string | null,
  before: Date,
  database: DB,
  revision?: string,
) {
  return database.transaction(
    async (tx) => {
      if (revision) {
        const [state] = await tx
          .select({ revision: lineupPopulationState.revision })
          .from(lineupPopulationState);
        if (state?.revision !== revision)
          throw Object.assign(new Error("Lineup population revision changed."), {
            digest: LINEUP_POPULATION_CHANGED,
          });
      }
      const { currentImportIds, matchIds } = await getCurrentStatsSelectionInTx(tx, {
        before,
        excludeMatchId: excludeMatchId ?? undefined,
        requireVerifiedDemo: true,
      });
      if (!currentImportIds.length) return [];
      const { rows } = await tx.execute(sql`
      SELECT mps.user_id, count(*)::int AS maps, ${completeSum(roundsExpr)} AS rounds,
        ${simpleAvg("mps.rating_pro")} AS avg_rating, ${roundWeightedAvg("mps.adr")} AS avg_adr,
        ${perRound("mps.kills")} AS kpr, ${perRound("mps.kast_rounds")} AS kast,
        ${perRound("mps.first_kills")} AS fkpr, ${perRound("mps.trade_kills")} AS trade_kpr
      FROM match_player_stats mps
      JOIN users u ON u.id = mps.user_id AND u.status = 'active'
      JOIN match_maps mm ON mm.id = mps.map_id AND mm.match_id = mps.match_id
      JOIN (${effectiveMatchRosterIdentitiesQuery(tx, matchIds)})
        AS lineup(match_id, entry_id, event_roster_member_id, user_id, steam64, is_starter)
        ON lineup.match_id = mps.match_id AND lineup.user_id = mps.user_id
      WHERE mps.verified_by_admin IS NOT NULL
        AND ${scoreboardImportCondition("mps", currentImportIds, true)}
        AND ${unambiguousScoreboardRow(currentImportIds)}
        AND mm.completed_at IS NOT NULL AND mm.score_a + mm.score_b > 0
      GROUP BY mps.user_id
      ORDER BY mps.user_id
    `);
      const numberOrNull = (value: unknown) => (value == null ? null : Number(value));
      return rows.map((row) => ({
        userId: row.user_id as string | null,
        maps: Number(row.maps),
        rounds: numberOrNull(row.rounds),
        avgRating: numberOrNull(row.avg_rating),
        avgAdr: numberOrNull(row.avg_adr),
        kpr: numberOrNull(row.kpr),
        kast: numberOrNull(row.kast),
        fkpr: numberOrNull(row.fkpr),
        tradeKpr: numberOrNull(row.trade_kpr),
      }));
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

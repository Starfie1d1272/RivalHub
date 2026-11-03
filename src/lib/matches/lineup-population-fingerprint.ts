import "server-only";

import { sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { CURRENT_DAK_SEMANTIC_PROFILE } from "@/lib/demo-integration/semantic-profile";
import { STATISTICS_PROJECTION_VERSION } from "@/lib/stats/projection-version";

/** Conservative raw-input fingerprint. Keep in sync with lineup selection,
 * identity resolution and the nine-field leaderboard projection. On a cache
 * miss the canonical TypeScript selection still runs in this same snapshot.
 * No Evidence payload or tournament/performance facts leave the database. */
export async function fingerprintLineupInputs(tx: TxDb, matchId: string, before: Date): Promise<string> {
  // Bound only this optional optimization, never loosen an existing timeout.
  const configured = await tx.execute(sql`
    WITH prior AS MATERIALIZED (
      SELECT current_setting('statement_timeout') AS timeout, setting::bigint AS timeout_ms
      FROM pg_settings WHERE name = 'statement_timeout'
    )
    SELECT timeout AS prior_timeout,
      set_config('statement_timeout', CASE WHEN timeout_ms = 0 OR timeout_ms > 750 THEN '750ms' ELSE timeout END, true)
    FROM prior
  `);
  const priorTimeout = configured.rows[0]?.prior_timeout;
  if (typeof priorTimeout !== "string") throw new Error("Missing prior statement timeout");
  const { rows } = await tx.execute(sql`
WITH candidates AS MATERIALIZED (
  SELECT id, season_id, stage, entry_a_id, entry_b_id, major_stage_run_id,
         status, test_config IS NULL AS official, completed_at, round, format, is_forfeit, score_a, score_b
  FROM matches
  WHERE completed_at < ${before.toISOString()}::timestamptz AND id <> ${matchId}::uuid
), maps AS MATERIALIZED (
  SELECT id, match_id, map_order, map_name, score_a, score_b, completed_at FROM match_maps
), rosters AS MATERIALIZED (
  SELECT r.id, r.match_id, r.entry_id, r.status FROM match_rosters r JOIN candidates c ON c.id=r.match_id
), imports AS MATERIALIZED (
  SELECT i.id, i.match_map_id, i.semantic_profile, i.status, i.evidence_revision,
         i.payload_sha256, i.demo_sha256, i.analysis_version, i.created_at
  FROM match_demo_imports i JOIN maps mm ON mm.id=i.match_map_id JOIN candidates c ON c.id=mm.match_id
), records AS (
  SELECT jsonb_build_array('match',id,season_id,stage,entry_a_id,entry_b_id,major_stage_run_id,status,official,completed_at) AS row_value FROM candidates
  UNION ALL SELECT jsonb_build_array('season',id,status) FROM seasons
  UNION ALL SELECT jsonb_build_array('map',id,match_id,map_order,map_name,score_a,score_b,completed_at) FROM maps
  UNION ALL SELECT jsonb_build_array('roster',id,match_id,entry_id,status) FROM rosters
  UNION ALL SELECT jsonb_build_array('member',p.roster_id,p.event_roster_member_id,p.is_starter,e.id,e.user_id) FROM match_roster_players p JOIN rosters r ON r.id=p.roster_id JOIN event_roster_members e ON e.id=p.event_roster_member_id
  UNION ALL SELECT jsonb_build_array('import',id,match_map_id,semantic_profile,status,evidence_revision,payload_sha256,demo_sha256,analysis_version,created_at) FROM imports
  UNION ALL SELECT jsonb_build_array('projection',p.import_id,p.projection_version,p.payload_sha256,p.demo_sha256,p.semantic_profile,p.analysis_version,p.evidence_revision,p.identity_bindings) FROM match_demo_stat_projections p JOIN imports i ON i.id=p.import_id
  UNION ALL SELECT jsonb_build_array('stat',s.match_id,s.map_id,s.user_id,s.dak_import_id,s.verified_by_admin IS NOT NULL,encode(float4send(s.rating_pro),'hex'),encode(float4send(s.adr),'hex'),s.kills,s.kast_rounds,s.first_kills,s.trade_kills) FROM match_player_stats s JOIN candidates c ON c.id=s.match_id
    -- Canonical inner query references these fields even though its outer nine-column
    -- projection discards them. Preserve column permission checks without keying on them.
    WHERE (s.rws IS NULL OR s.rws IS NOT NULL) AND (s.we IS NULL OR s.we IS NOT NULL)
      AND (s.deaths IS NULL OR s.deaths IS NOT NULL) AND (s.hs_percent IS NULL OR s.hs_percent IS NOT NULL)
      AND (s.first_deaths IS NULL OR s.first_deaths IS NOT NULL) AND (s.multi_kills IS NULL OR s.multi_kills IS NOT NULL)
      AND (s.clutches IS NULL OR s.clutches IS NOT NULL)
  UNION ALL SELECT jsonb_build_array('user',id,status,steam64,display_name,perfect_name) FROM users
  UNION ALL SELECT jsonb_build_array('alias',id,user_id,steam64,status) FROM user_gameplay_steam_ids
  UNION ALL SELECT jsonb_build_array('profile',steam64,persona_name) FROM steam_profiles
  UNION ALL SELECT jsonb_build_array('entry',id,name) FROM competition_entries
), bounded AS MATERIALIZED (
 SELECT CASE WHEN octet_length(convert_to(row_value::text, 'UTF8')) <= 65536
         THEN encode(sha256(convert_to(row_value::text, 'UTF8')), 'hex') ELSE NULL END AS h,
        octet_length(convert_to(row_value::text, 'UTF8'))::bigint AS input_bytes
 FROM records LIMIT 20001
)
SELECT CASE WHEN count(*) > 20000 OR count(h) <> count(*) OR coalesce(sum(input_bytes), 0) > 8388608 THEN NULL ELSE
       encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') END AS fingerprint,
       current_database() AS database_name, inet_server_addr()::text AS server_address,
       inet_server_port() AS server_port, pg_postmaster_start_time()::text AS server_started,
       current_setting('server_version_num') AS server_version,
       current_user AS effective_role, session_user AS session_role,
       current_setting('search_path') AS search_path,
       (SELECT datcollate FROM pg_catalog.pg_database WHERE datname = current_database()) AS collation,
       current_setting('extra_float_digits') AS float_digits, current_setting('DateStyle') AS date_style,
       current_setting('TimeZone') AS timezone, current_setting('row_security') AS row_security,
       current_setting('request.jwt.claims', true) IS NULL AS claims_missing,
       encode(sha256(convert_to(coalesce(current_setting('request.jwt.claims', true), ''), 'UTF8')), 'hex') AS claims_hash,
       jsonb_build_array(to_regclass('matches')::oid, to_regclass('seasons')::oid,
         to_regclass('match_maps')::oid, to_regclass('match_rosters')::oid,
         to_regclass('match_roster_players')::oid, to_regclass('event_roster_members')::oid,
         to_regclass('match_demo_imports')::oid, to_regclass('match_demo_stat_projections')::oid,
         to_regclass('match_player_stats')::oid, to_regclass('users')::oid,
         to_regclass('user_gameplay_steam_ids')::oid, to_regclass('steam_profiles')::oid,
         to_regclass('competition_entries')::oid) AS relation_ids
FROM bounded;

  `);
  // Restore before canonical selection/aggregate. A failure aborts this optional
  // transaction and the caller retries the original path in a fresh snapshot.
  await tx.execute(sql`SELECT set_config('statement_timeout', ${priorTimeout}, true)`);
  const row = rows[0];
  if (!row || typeof row.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(row.fingerprint)
    || typeof row.database_name !== "string" || typeof row.server_started !== "string"
    || typeof row.server_version !== "string" || typeof row.effective_role !== "string"
    || typeof row.session_role !== "string" || typeof row.search_path !== "string"
    || typeof row.collation !== "string" || typeof row.float_digits !== "string"
    || typeof row.date_style !== "string" || typeof row.timezone !== "string"
    || typeof row.row_security !== "string" || typeof row.claims_missing !== "boolean" || typeof row.claims_hash !== "string"
    || !Array.isArray(row.relation_ids) || row.relation_ids.length !== 13
    || row.relation_ids.some(id => typeof id !== "number" || !Number.isInteger(id))) throw new Error("Invalid lineup input fingerprint");
  // Include database/backend namespace; do not expose this key outside the process.
  return JSON.stringify(["lineup-input-v1", CURRENT_DAK_SEMANTIC_PROFILE, STATISTICS_PROJECTION_VERSION,
    process.env.RIVALHUB_RELEASE_COMMIT ?? "unknown", row.database_name, row.server_address, row.server_port,
    row.server_started, row.server_version, row.effective_role, row.session_role, row.search_path, row.collation,
    row.float_digits, row.date_style, row.timezone, row.row_security, row.claims_missing, row.claims_hash, row.relation_ids, row.fingerprint]);
}

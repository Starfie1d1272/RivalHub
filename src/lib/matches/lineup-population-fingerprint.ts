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
  const { rows } = await tx.execute(sql`
WITH candidates AS MATERIALIZED (
  SELECT id, season_id, stage, entry_a_id, entry_b_id, major_stage_run_id,
         status, test_config IS NULL AS official, completed_at, round, format, is_forfeit, score_a, score_b
  FROM public.matches
  WHERE completed_at < ${before.toISOString()}::timestamptz AND id <> ${matchId}::uuid
), maps AS MATERIALIZED (
  SELECT id, match_id, map_order, map_name, score_a, score_b, completed_at FROM public.match_maps
), rosters AS MATERIALIZED (
  SELECT r.id, r.match_id, r.entry_id, r.status FROM public.match_rosters r JOIN candidates c ON c.id=r.match_id
), imports AS MATERIALIZED (
  SELECT i.id, i.match_map_id, i.semantic_profile, i.status, i.evidence_revision,
         i.payload_sha256, i.demo_sha256, i.analysis_version, i.created_at
  FROM public.match_demo_imports i JOIN maps mm ON mm.id=i.match_map_id JOIN candidates c ON c.id=mm.match_id
), records AS (
  SELECT jsonb_build_array('match',id,season_id,stage,entry_a_id,entry_b_id,major_stage_run_id,status,official,completed_at,round,format,is_forfeit,score_a,score_b) AS row_value FROM candidates
  UNION ALL SELECT jsonb_build_array('season',id,status) FROM public.seasons
  UNION ALL SELECT jsonb_build_array('map',id,match_id,map_order,map_name,score_a,score_b,completed_at) FROM maps
  UNION ALL SELECT jsonb_build_array('roster',id,match_id,entry_id,status) FROM rosters
  UNION ALL SELECT jsonb_build_array('member',p.roster_id,p.event_roster_member_id,p.is_starter,e.id,e.user_id) FROM public.match_roster_players p JOIN rosters r ON r.id=p.roster_id JOIN public.event_roster_members e ON e.id=p.event_roster_member_id
  UNION ALL SELECT jsonb_build_array('import',id,match_map_id,semantic_profile,status,evidence_revision,payload_sha256,demo_sha256,analysis_version,created_at) FROM imports
  UNION ALL SELECT jsonb_build_array('projection',p.import_id,p.projection_version,p.payload_sha256,p.demo_sha256,p.semantic_profile,p.analysis_version,p.evidence_revision,p.identity_bindings) FROM public.match_demo_stat_projections p JOIN imports i ON i.id=p.import_id
  UNION ALL SELECT jsonb_build_array('stat',s.id,s.match_id,s.map_id,s.user_id,s.dak_import_id,s.verified_by_admin,encode(float4send(s.rating_pro),'hex'),encode(float4send(s.adr),'hex'),s.kills,s.kast_rounds,s.first_kills,s.trade_kills) FROM public.match_player_stats s JOIN candidates c ON c.id=s.match_id
  UNION ALL SELECT jsonb_build_array('user',id,status,steam64,display_name,perfect_name) FROM public.users
  UNION ALL SELECT jsonb_build_array('alias',id,user_id,steam64,status) FROM public.user_gameplay_steam_ids
  UNION ALL SELECT jsonb_build_array('profile',steam64,persona_name) FROM public.steam_profiles
  UNION ALL SELECT jsonb_build_array('entry',id,name) FROM public.competition_entries
), hashes AS (
 SELECT encode(sha256(convert_to(row_value::text,'UTF8')),'hex') AS h FROM records
)
SELECT encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') AS fingerprint,
       current_database() AS database_name, inet_server_addr()::text AS server_address,
       inet_server_port() AS server_port, pg_postmaster_start_time()::text AS server_started,
       current_setting('server_version_num') AS server_version
FROM hashes;

  `);
  const row = rows[0];
  if (!row || typeof row.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(row.fingerprint)
    || typeof row.database_name !== "string" || typeof row.server_started !== "string"
    || typeof row.server_version !== "string") throw new Error("Invalid lineup input fingerprint");
  // Include database/backend namespace; do not expose this key outside the process.
  return JSON.stringify(["lineup-input-v1", CURRENT_DAK_SEMANTIC_PROFILE, STATISTICS_PROJECTION_VERSION,
    process.env.RIVALHUB_RELEASE_COMMIT ?? "unknown", row.database_name, row.server_address, row.server_port,
    row.server_started, row.server_version, row.fingerprint]);
}

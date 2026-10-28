import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { hasActivePublicSanction } from "@/lib/discipline/public-query";

export type PublicMatchRefreshScope = { matchId: string; stage?: never } | { stage: string; matchId?: never };

/** Change detector only, never an authority/revision or a cached permission decision.
 * One statement observes a consistent snapshot and returns one opaque public token.
 * Ancillary/global profile and career changes are recovered by the bounded full resync.
 */
export async function loadPublicMatchRefreshToken(seasonId: string, scope: PublicMatchRefreshScope): Promise<string> {
  const condition = scope.matchId
    ? sql`m.id = ${scope.matchId}`
    : sql`m.stage = ${scope.stage} and m.test_config is null`;
  const result = await db.execute<{ version: string }>(sql`
    with scoped as (
      select m.id, m.entry_a_id, m.entry_b_id, m.status, m.updated_at, m.scheduled_at,
        m.completed_at, m.started_at, m.gameplay_started_at, m.completion_deadline, m.score_a, m.score_b, m.result_disposition, m.mvp_winner_user_id
      from matches m where m.season_id = ${seasonId} and ${condition}
    )
    select md5(jsonb_build_object(
      'season', (select jsonb_build_array(s.status, s.updated_at) from seasons s where s.id = ${seasonId}),
      'matches', (select jsonb_agg(to_jsonb(m) order by m.id) from scoped m),
      'maps', (select jsonb_agg(jsonb_build_array(mm.id, mm.map_order, mm.map_name, mm.picked_by_entry_id,
        mm.team_a_start_side, mm.score_a, mm.score_b, mm.started_at, mm.completed_at,
        ${scope.matchId ? sql`mm.provisional_players` : sql`null`}) order by mm.id)
        from match_maps mm join scoped m on m.id = mm.match_id),
      'veto', (select jsonb_agg(jsonb_build_array(v.match_id, v.revision, v.started_at, v.completed_at) order by v.match_id)
        from match_veto_sessions v join scoped m on m.id = v.match_id),
      'live', (select jsonb_agg(jsonb_build_array(l.match_id, l.current_map_id, l.map_execution_phase, l.lineup_health) order by l.match_id)
        from match_live_sessions l join scoped m on m.id = l.match_id where l.closed_at is null),
      'entries', (select jsonb_agg(jsonb_build_array(e.id, e.name, e.logo_url, e.updated_at) order by e.id)
        from competition_entries e where e.id in (select entry_a_id from scoped union select entry_b_id from scoped)),
      'stageDirectory', (select jsonb_agg(d.stage order by d.stage) from
        (select distinct stage from matches where season_id = ${seasonId} and test_config is null) d),
      'stages', (select jsonb_agg(jsonb_build_array(r.id, r.stage_key, r.finalized_round) order by r.id)
        from major_stage_runs r where r.season_id = ${seasonId}),
      'final', (select jsonb_agg(jsonb_build_array(f.id, f.status, f.champion_entry_id, f.confirmed_at) order by f.id)
        from major_final_results f where f.season_id = ${seasonId}),
      'qualification', (select jsonb_agg(jsonb_build_array(q.id, q.started_at, q.completed_at) order by q.id)
        from competition_qualification_runs q where q.season_id = ${seasonId}),
      'imports', ${scope.matchId ? sql`(select jsonb_agg(jsonb_build_array(i.id, i.status, i.confirmed_at, i.payload_sha256) order by i.id)
        from match_demo_imports i join scoped m on m.id = i.match_id)` : sql`null`},
      'scoreboard', ${scope.matchId ? sql`(select jsonb_agg(jsonb_build_array(to_jsonb(p) - 'verified_by_admin' - 'verified_at', p.verified_by_admin is not null) order by p.id)
        from match_player_stats p join scoped m on m.id = p.match_id)` : sql`null`},
      'identities', ${scope.matchId ? sql`(select jsonb_agg(jsonb_build_array(users.id, users.status, users.updated_at,
        users.display_name, users.perfect_name, sp.persona_name, sp.avatar_url, ${hasActivePublicSanction(users.id)}) order by users.id)
        from users left join steam_profiles sp on sp.steam64 = users.steam64
        where users.id in (select e.user_id from event_roster_members e join event_rosters r on r.id = e.event_roster_id
          where r.entry_id in (select entry_a_id from scoped union select entry_b_id from scoped)))` : sql`null`},
      'members', ${scope.matchId ? sql`(select jsonb_agg(jsonb_build_array(e.id, e.user_id, e.is_current, e.is_primary_starter) order by e.id)
        from event_roster_members e join event_rosters r on r.id = e.event_roster_id
        where r.entry_id in (select entry_a_id from scoped union select entry_b_id from scoped))` : sql`null`},
      'rosters', ${scope.matchId ? sql`(select jsonb_agg(jsonb_build_array(r.id, r.status, r.updated_at,
        (select jsonb_agg(jsonb_build_array(p.event_roster_member_id, p.is_starter, p.is_veto_representative) order by p.event_roster_member_id)
          from match_roster_players p where p.roster_id = r.id)) order by r.id)
        from match_rosters r join scoped m on m.id = r.match_id)` : sql`null`},
      'proposals', ${scope.matchId ? sql`(select jsonb_agg(jsonb_build_array(p.id, p.status, p.updated_at) order by p.id)
        from match_time_proposals p join scoped m on m.id = p.match_id)` : sql`null`}
    )::text) as version
  `);
  return result.rows[0].version;
}

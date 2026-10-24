import { readConfirmedDemoIdentityScopeInTx } from "./statistics-invalidation";
import "server-only";
import { sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { AppError, ErrorCode } from "@/lib/errors";

/** Called under identity gate and both user UPDATE locks, before any reparenting.
 * Include the whole event closure, not a current page or just Demo's event.
 * NOWAIT is intentional: waiting here while holding user UPDATE would invert
 * user SHARE → season admission and official actor FK checks. Contention rolls
 * back the whole command; callers must freshly preflight, never auto-replay.
 */
export async function lockUserMergeEventClosureInTx(tx: TxDb, canonicalId: string, mergedId: string) {
  const ids = [canonicalId, mergedId];
  try {
    // Installation authority precedes event fencing in ingress and revocation.
    await tx.execute(sql`SELECT id FROM mizar_installations
      WHERE authorized_by_user_id = ANY(${sql.param(ids)}::uuid[]) ORDER BY id FOR UPDATE NOWAIT`);
    const imports = await readConfirmedDemoIdentityScopeInTx(tx, { userId: mergedId });
    const importMatchIds = imports.map(row => row.match_id);
    const scope = await tx.execute<{ season_id: string | null; match_id: string | null }>(sql`
      WITH affected_entries AS (
        SELECT id, competition_id FROM competition_entries e
        WHERE representative_user_id = ANY(${sql.param(ids)}::uuid[])
          OR EXISTS (SELECT 1 FROM competition_entry_participants p WHERE p.entry_id=e.id AND p.user_id=ANY(${sql.param(ids)}::uuid[]))
          OR EXISTS (SELECT 1 FROM competition_entry_roster_revisions r JOIN competition_entry_roster_members m ON m.revision_id=r.id WHERE r.entry_id=e.id AND m.user_id=ANY(${sql.param(ids)}::uuid[]))
          OR EXISTS (SELECT 1 FROM event_rosters r JOIN event_roster_members m ON m.event_roster_id=r.id WHERE r.entry_id=e.id AND m.user_id=ANY(${sql.param(ids)}::uuid[]))
          OR EXISTS (SELECT 1 FROM teams t WHERE t.id=e.team_id AND t.captain_user_id=ANY(${sql.param(ids)}::uuid[]))
          OR EXISTS (SELECT 1 FROM team_memberships m WHERE m.team_id=e.team_id AND m.user_id=ANY(${sql.param(ids)}::uuid[]))
      ), affected_matches AS (
        SELECT id, season_id FROM matches m WHERE m.mvp_winner_user_id=ANY(${sql.param(ids)}::uuid[])
          OR EXISTS (SELECT 1 FROM match_player_stats p WHERE p.match_id=m.id AND p.user_id=ANY(${sql.param(ids)}::uuid[]))
          OR EXISTS (SELECT 1 FROM match_mvp_votes v WHERE v.match_id=m.id AND (v.voter_user_id=ANY(${sql.param(ids)}::uuid[]) OR v.player_user_id=ANY(${sql.param(ids)}::uuid[])))
          OR EXISTS (SELECT 1 FROM match_commentators c WHERE c.match_id=m.id AND c.user_id=ANY(${sql.param(ids)}::uuid[]))
          OR m.id=ANY(${sql.param(importMatchIds)}::uuid[])
      ), affected_seasons AS (
        SELECT competition_id AS id FROM affected_entries
        UNION SELECT season_id FROM affected_matches WHERE season_id IS NOT NULL
        UNION SELECT season_id FROM season_registrations WHERE user_id=ANY(${sql.param(ids)}::uuid[])
        UNION SELECT competition_id FROM competition_entry_active_claims WHERE user_id=ANY(${sql.param(ids)}::uuid[])
        UNION SELECT season_id FROM tournament_honors WHERE user_id=ANY(${sql.param(ids)}::uuid[])
        UNION SELECT season_id FROM post_event_adjudications WHERE target_user_id=ANY(${sql.param(ids)}::uuid[])
        UNION SELECT season_id FROM disciplinary_cases WHERE subject_user_id=ANY(${sql.param(ids)}::uuid[])
        UNION SELECT season_id FROM season_admin_grants WHERE user_id=ANY(${sql.param(ids)}::uuid[])
        UNION SELECT competition_id FROM mizar_installations WHERE authorized_by_user_id=ANY(${sql.param(ids)}::uuid[])
        UNION SELECT a.season_id FROM community_awards a WHERE a.recipient_user_id=ANY(${sql.param(ids)}::uuid[])
          OR EXISTS (SELECT 1 FROM community_award_recipients r WHERE r.award_id=a.id AND r.user_id=ANY(${sql.param(ids)}::uuid[]))
          OR EXISTS (SELECT 1 FROM community_award_evidence e WHERE e.award_id=a.id AND e.candidate_user_id=ANY(${sql.param(ids)}::uuid[]))
      )
      SELECT id AS season_id, NULL::uuid AS match_id FROM affected_seasons
      UNION SELECT NULL::uuid, id FROM affected_matches WHERE season_id IS NULL
    `);
    const seasonIds = scope.rows.flatMap(row => row.season_id ? [row.season_id] : []).sort();
    const independentMatchIds = scope.rows.flatMap(row => row.match_id ? [row.match_id] : []).sort();
    if (seasonIds.length) await tx.execute(sql`SELECT id FROM seasons WHERE id=ANY(${sql.param(seasonIds)}::uuid[]) ORDER BY id FOR UPDATE NOWAIT`);
    await tx.execute(sql`SELECT id FROM matches WHERE season_id=ANY(${sql.param(seasonIds)}::uuid[]) OR id=ANY(${sql.param(independentMatchIds)}::uuid[]) ORDER BY id FOR UPDATE NOWAIT`);
  } catch (error) {
    const failure = error as { code?: string; cause?: { code?: string } };
    if ((failure.cause?.code ?? failure.code) === "55P03") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "相关赛事或数据源正在变更，本次归并未执行。请稍后重新预检并确认。");
    }
    throw error;
  }
}

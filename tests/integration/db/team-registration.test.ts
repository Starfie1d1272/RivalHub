import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { transferCompetitionEntryRepresentativeInTx } from "../../../src/lib/competition-entries/commands";
import { BUILT_IN_COMPETITIVE_PLATFORMS } from "../../../src/lib/competitive/builtins";
import { computeParticipantReadiness, loadParticipantQualificationFacts } from "../../../src/lib/qualification/service";
import { capturePostgresError, localDatabaseUrl } from "./harness/database";

const databaseUrl = localDatabaseUrl();

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 5 });
  const client = await pool.connect();
  const ids = { season: randomUUID(), captain: randomUUID(), member: randomUUID(), team: randomUUID(), entry: randomUUID(), participant: randomUUID(), revision: randomUUID(), roster: randomUUID() };
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)", [ids.captain, `captain-${ids.captain}@local.test`, ids.member, `member-${ids.member}@local.test`]);
    await client.query("INSERT INTO seasons (id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft, min_team_size, max_team_size) VALUES ($1, $2, 'Local Entry Registration', 'Major', 'registration', 'team', false, false, 2, 5)", [ids.season, `local-entry-${ids.season}`]);
    await client.query("INSERT INTO teams (id, slug, name, creator_user_id, captain_user_id) VALUES ($1, $2, 'Long-lived Local Team', $3, $3)", [ids.team, `local-team-${ids.team.slice(0, 8)}`, ids.captain]);
    await client.query("INSERT INTO team_memberships (team_id, user_id, status, invited_by_user_id) VALUES ($1, $2, 'active', $2), ($1, $3, 'active', $2)", [ids.team, ids.captain, ids.member]);
    await client.query("INSERT INTO team_captain_changes (team_id, from_user_id, to_user_id, changed_by_actor_id) VALUES ($1, NULL, $2, 'local-test')", [ids.team, ids.captain]);
    await client.query("INSERT INTO team_name_changes (team_id, old_name, new_name, changed_by_actor_id) VALUES ($1, NULL, 'Long-lived Local Team', 'local-test')", [ids.team]);
    const createdCaptain = await client.query<{ captain_user_id: string; history_captain: string; history_name: string }>(`
      SELECT t.captain_user_id,
        (SELECT to_user_id FROM team_captain_changes WHERE team_id = t.id ORDER BY changed_at DESC, id DESC LIMIT 1) AS history_captain,
        (SELECT new_name FROM team_name_changes WHERE team_id = t.id ORDER BY changed_at DESC, id DESC LIMIT 1) AS history_name
      FROM teams t WHERE t.id = $1`, [ids.team]);
    if (!createdCaptain.rows[0] || createdCaptain.rows[0].captain_user_id !== ids.captain || createdCaptain.rows[0].history_captain !== ids.captain || createdCaptain.rows[0].history_name !== "Long-lived Local Team") throw new Error("长期 Team 创建没有同时建立当前字段与 append-only 历史。");
    await client.query("UPDATE teams SET captain_user_id = $2 WHERE id = $1", [ids.team, ids.member]);
    await client.query("INSERT INTO team_captain_changes (team_id, from_user_id, to_user_id, changed_at, changed_by_actor_id) VALUES ($1, $2, $3, now() + interval '1 millisecond', 'local-test')", [ids.team, ids.captain, ids.member]);
    const transferredCaptain = await client.query<{ captain_user_id: string; history_captain: string }>(`
      SELECT t.captain_user_id,
        (SELECT to_user_id FROM team_captain_changes WHERE team_id = t.id ORDER BY changed_at DESC, id DESC LIMIT 1) AS history_captain
      FROM teams t WHERE t.id = $1`, [ids.team]);
    if (!transferredCaptain.rows[0] || transferredCaptain.rows[0].captain_user_id !== ids.member || transferredCaptain.rows[0].history_captain !== ids.member) throw new Error("队长交接没有原子收敛当前字段与 append-only 历史。");
    await client.query("UPDATE team_memberships SET status = 'left', ended_at = now(), ended_reason = 'disbanded' WHERE team_id = $1 AND ended_at IS NULL", [ids.team]);
    await client.query("UPDATE teams SET status = 'disbanded', disbanded_at = now(), disbanded_by = 'local-test' WHERE id = $1", [ids.team]);
    const disbanded = await client.query<{ current_captain: string; current_members: string; status: string }>(`
      SELECT t.status::text,
        t.captain_user_id::text AS current_captain,
        (SELECT count(*)::text FROM team_memberships WHERE team_id = t.id AND ended_at IS NULL) AS current_members
      FROM teams t WHERE t.id = $1`, [ids.team]);
    if (disbanded.rows[0]?.status !== "disbanded" || disbanded.rows[0]?.current_captain !== ids.member || disbanded.rows[0]?.current_members !== "0") throw new Error("解散必须结束当前 membership，但保留最后 captain pointer。");
    await client.query("INSERT INTO competition_entries (id, competition_id, source, team_id, name, representative_user_id, current_roster_revision_id, registration_status) VALUES ($1, $2, 'linked_team', $3, 'Long-lived Local Team', $4, $5, 'draft')", [ids.entry, ids.season, ids.team, ids.member, ids.revision]);
    await client.query("INSERT INTO competition_entry_representative_changes (entry_id, from_user_id, to_user_id, changed_by_actor_id) VALUES ($1, NULL, $2, 'local-test')", [ids.entry, ids.member]);
    await client.query("INSERT INTO competition_entry_participants (id, entry_id, user_id, status, confirmed_at, invited_by_user_id) VALUES ($1, $2, $3, 'confirmed', now(), $3)", [ids.participant, ids.entry, ids.captain]);
    await client.query("INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by) VALUES ($1, $2, 1, 'draft', 'local-test')", [ids.revision, ids.entry]);
    await client.query("INSERT INTO competition_entry_roster_members (revision_id, participant_id, user_id, is_primary_starter) VALUES ($1, $2, $3, true)", [ids.revision, ids.participant, ids.captain]);
    await client.query("INSERT INTO event_rosters (id, entry_id, source_roster_revision_id, status) VALUES ($1, $2, $3, 'preparing')", [ids.roster, ids.entry, ids.revision]);
    await client.query("INSERT INTO event_roster_members (event_roster_id, participant_id, user_id, is_primary_starter) VALUES ($1, $2, $3, true)", [ids.roster, ids.participant, ids.captain]);
    const facts = await client.query<{ entries: string; commitments: string; frozen_members: string }>("SELECT (SELECT count(*) FROM competition_entries WHERE id = $1) entries, (SELECT count(*) FROM competition_entry_participants WHERE entry_id = $1) commitments, (SELECT count(*) FROM event_roster_members WHERE event_roster_id = $2) frozen_members", [ids.entry, ids.roster]);
    if (facts.rows[0]?.entries !== "1" || facts.rows[0]?.commitments !== "1" || facts.rows[0]?.frozen_members !== "1") throw new Error("报名、成员确认与赛事名单未分别持久化。");
    const invalidEntryShape = await capturePostgresError(client, () => client.query("INSERT INTO competition_entries (competition_id, source, team_id, name, representative_user_id, current_roster_revision_id) VALUES ($1, 'event_native', $2, 'invalid', $3, gen_random_uuid())", [ids.season, ids.team, ids.captain]));
    expect(invalidEntryShape).toMatchObject({ code: "23514" });
    await client.query("SET LOCAL ROLE authenticated");
    const deniedDataApiRead = await capturePostgresError(client, () => client.query("SELECT id FROM competition_entries LIMIT 1"));
    expect(deniedDataApiRead).toMatchObject({ code: "42501" });
    await client.query("RESET ROLE");
    await client.query("ROLLBACK");
    await exerciseConcurrencyAndInvariants(pool);
    await exerciseReinviteRemediationAndPrestart(pool);
    await exerciseQualificationWithRealCatalog(pool);
    console.log("CompetitionEntry local integration passed: commitment race, withdrawn re-invite, deadline remediation state, approved-only prestart source, active Team and captain projection invariants, frozen roster immutability, cross-Entry rejection, Entry shape constraint, Data API denial, and real 2026 competitive catalog readiness.");
  } finally { client.release(); await pool.end(); }
}

async function exerciseReinviteRemediationAndPrestart(pool: Pool): Promise<void> {
  const ids = { season: randomUUID(), captain: randomUUID(), member: randomUUID(), entry: randomUUID(), participant: randomUUID(), revision: randomUUID() };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)", [ids.captain, `remediation-captain-${ids.captain}@local.test`, ids.member, `remediation-member-${ids.member}@local.test`]);
    await client.query("INSERT INTO seasons (id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft, min_team_size, max_team_size, registration_closes_at) VALUES ($1, $2, 'Local Remediation', 'Major', 'registration', 'team', false, false, 1, 5, now() - interval '1 minute')", [ids.season, `local-remediation-${ids.season}`]);
    await client.query("INSERT INTO competition_entries (id, competition_id, source, name, representative_user_id, current_roster_revision_id, registration_status) VALUES ($1, $2, 'event_native', 'Remediation Entry', $3, $4, 'changes_requested')", [ids.entry, ids.season, ids.captain, ids.revision]);
    await client.query("INSERT INTO competition_entry_representative_changes (entry_id, from_user_id, to_user_id, changed_by_actor_id) VALUES ($1, NULL, $2, 'local-test')", [ids.entry, ids.captain]);
    await client.query("INSERT INTO competition_entry_participants (id, entry_id, user_id, status, withdrawn_at, invited_by_user_id) VALUES ($1, $2, $3, 'withdrawn', now(), $4)", [ids.participant, ids.entry, ids.member, ids.captain]);
    const duplicateParticipantCommitment = await capturePostgresError(client, () => client.query("INSERT INTO competition_entry_participants (entry_id, user_id, status, invited_by_user_id) VALUES ($1, $2, 'invited', $3)", [ids.entry, ids.member, ids.captain]));
    expect(duplicateParticipantCommitment).toMatchObject({ code: "23505" });
    // The action reuses this row (rather than inserting another commitment), then the participant must consent again.
    await client.query("UPDATE competition_entry_participants SET status = 'invited', confirmed_at = NULL, withdrawn_at = NULL, updated_at = now() WHERE id = $1", [ids.participant]);
    const reinvited = await client.query<{ status: string; commitments: string }>("SELECT status::text, (SELECT count(*)::text FROM competition_entry_participants WHERE entry_id = $1 AND user_id = $2) AS commitments FROM competition_entry_participants WHERE id = $3", [ids.entry, ids.member, ids.participant]);
    if (reinvited.rows[0]?.status !== "invited" || reinvited.rows[0]?.commitments !== "1") throw new Error("withdrawn 成员重新邀请没有复用唯一 participant commitment。");
    await client.query("INSERT INTO competition_entry_active_claims (competition_id, user_id, entry_id, participant_id) VALUES ($1, $2, $3, $4)", [ids.season, ids.member, ids.entry, ids.participant]);
    await client.query("UPDATE competition_entry_participants SET status = 'confirmed', confirmed_at = now() WHERE id = $1", [ids.participant]);
    await client.query("INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by) VALUES ($1, $2, 2, 'draft', 'local-test')", [ids.revision, ids.entry]);
    await client.query("INSERT INTO competition_entry_roster_members (revision_id, participant_id, user_id, is_primary_starter) VALUES ($1, $2, $3, true)", [ids.revision, ids.participant, ids.member]);
    // A past deadline is deliberately represented with changes_requested + draft revision: the server-action policy test gates this remediation exception.
    await client.query("UPDATE competition_entry_roster_revisions SET status = 'submitted', submitted_at = now() WHERE id = $1", [ids.revision]);
    await client.query("UPDATE competition_entries SET registration_status = 'submitted' WHERE id = $1", [ids.entry]);
    await client.query("UPDATE competition_entry_roster_revisions SET status = 'approved', approved_at = now() WHERE id = $1", [ids.revision]);
    await client.query("UPDATE competition_entries SET registration_status = 'approved', approved_roster_revision_id = $2 WHERE id = $1", [ids.entry, ids.revision]);
    const prestartEligible = await client.query<{ count: string }>(`SELECT count(*)::text FROM competition_entries entry JOIN competition_entry_roster_revisions revision ON revision.id = entry.approved_roster_revision_id AND revision.entry_id = entry.id WHERE entry.competition_id = $1 AND entry.registration_status = 'approved' AND revision.status = 'approved'`, [ids.season]);
    if (prestartEligible.rows[0]?.count !== "1") throw new Error("prestart 只能消费 approved Entry 的 approved roster revision。");
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function exerciseConcurrencyAndInvariants(pool: Pool): Promise<void> {
  const ids = { season: randomUUID(), shared: randomUUID(), captainA: randomUUID(), captainB: randomUUID(), teamA: randomUUID(), teamB: randomUUID(), entryA: randomUUID(), entryB: randomUUID(), participantA: randomUUID(), participantB: randomUUID(), revisionA: randomUUID(), revisionB: randomUUID(), revisionA2: randomUUID(), rosterA: randomUUID(), rosterB: randomUUID(), eventMemberA: randomUUID(), eventMemberB: randomUUID(), match: randomUUID(), matchRoster: randomUUID() };
  const setup = await pool.connect();
  try {
    await setup.query("BEGIN");
    await setup.query("INSERT INTO users (id, email) VALUES ($1,$2),($3,$4),($5,$6)", [ids.shared, `shared-${ids.shared}@local.test`, ids.captainA, `captain-a-${ids.captainA}@local.test`, ids.captainB, `captain-b-${ids.captainB}@local.test`]);
    await setup.query("INSERT INTO seasons (id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft, min_team_size, max_team_size) VALUES ($1,$2,'Local Entry Race','Major','registration','team',false,false,2,5)", [ids.season, `local-entry-race-${ids.season}`]);
    await setup.query("INSERT INTO teams (id,slug,name,creator_user_id,captain_user_id) VALUES ($1,$2,'Race Team A',$3,$3),($4,$5,'Race Team B',$6,$6)", [ids.teamA, `race-a-${ids.teamA.slice(0, 8)}`, ids.captainA, ids.teamB, `race-b-${ids.teamB.slice(0, 8)}`, ids.captainB]);
    await setup.query("INSERT INTO team_memberships (team_id,user_id,status,invited_by_user_id) VALUES ($1,$2,'active',$2),($3,$4,'active',$4)", [ids.teamA, ids.captainA, ids.teamB, ids.captainB]);
    await setup.query("INSERT INTO team_captain_changes (team_id,from_user_id,to_user_id,changed_by_actor_id) VALUES ($1,NULL,$2,'local-test'),($3,NULL,$4,'local-test')", [ids.teamA, ids.captainA, ids.teamB, ids.captainB]);
    await setup.query("INSERT INTO team_name_changes (team_id,old_name,new_name,changed_by_actor_id) VALUES ($1,NULL,'Race Team A','local-test'),($2,NULL,'Race Team B','local-test')", [ids.teamA, ids.teamB]);
    await setup.query("INSERT INTO competition_entries (id,competition_id,source,name,representative_user_id,current_roster_revision_id,registration_status) VALUES ($1,$2,'event_native','Entry A',$3,$4,'draft'),($5,$2,'event_native','Entry B',$6,$7,'draft')", [ids.entryA, ids.season, ids.captainA, ids.revisionA, ids.entryB, ids.captainB, ids.revisionB]);
    await setup.query("INSERT INTO competition_entry_representative_changes (entry_id,from_user_id,to_user_id,changed_by_actor_id) VALUES ($1,NULL,$2,'local-test'),($3,NULL,$4,'local-test')", [ids.entryA, ids.captainA, ids.entryB, ids.captainB]);
    await setup.query("INSERT INTO competition_entry_participants (id,entry_id,user_id,status,invited_by_user_id) VALUES ($1,$2,$3,'invited',$4),($5,$6,$3,'invited',$7)", [ids.participantA, ids.entryA, ids.shared, ids.captainA, ids.participantB, ids.entryB, ids.captainB]);
    await setup.query("INSERT INTO competition_entry_roster_revisions (id,entry_id,revision_number,status,created_by) VALUES ($1,$2,1,'draft','local-test')", [ids.revisionA, ids.entryA]);
    await setup.query("INSERT INTO competition_entry_roster_revisions (id,entry_id,revision_number,status,created_by) VALUES ($1,$2,1,'draft','local-test')", [ids.revisionB, ids.entryB]);
    await setup.query("INSERT INTO event_rosters (id,entry_id,source_roster_revision_id,status) VALUES ($1,$2,$3,'preparing')", [ids.rosterA, ids.entryA, ids.revisionA]);
    await setup.query("INSERT INTO event_rosters (id,entry_id,source_roster_revision_id,status) VALUES ($1,$2,$3,'preparing')", [ids.rosterB, ids.entryB, ids.revisionB]);
    await setup.query("COMMIT");

    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query("BEGIN");
      await second.query("BEGIN");
      await first.query("INSERT INTO competition_entry_active_claims (competition_id,user_id,entry_id,participant_id) VALUES ($1,$2,$3,$4)", [ids.season, ids.shared, ids.entryA, ids.participantA]);
      await first.query("UPDATE competition_entry_participants SET status = 'confirmed', confirmed_at = now() WHERE id = $1", [ids.participantA]);
      const competingClaim = second.query("INSERT INTO competition_entry_active_claims (competition_id,user_id,entry_id,participant_id) VALUES ($1,$2,$3,$4)", [ids.season, ids.shared, ids.entryB, ids.participantB]).then(() => { throw new Error("同一用户同时确认两个 Entry 不应成功。"); }, (error: { code?: string }) => {
        if (error.code !== "23505") throw error;
      });
      await first.query("COMMIT");
      await competingClaim;
      await second.query("ROLLBACK");
    } finally { first.release(); second.release(); }
    const claims = await setup.query<{ count: string }>("SELECT count(*) FROM competition_entry_active_claims WHERE competition_id = $1 AND user_id = $2", [ids.season, ids.shared]);
    if (claims.rows[0]?.count !== "1") throw new Error("active commitment race 没有收敛为唯一 claim。");

    const membershipA = await pool.connect();
    const membershipB = await pool.connect();
    try {
      await membershipA.query("BEGIN");
      await membershipB.query("BEGIN");
      await membershipA.query("INSERT INTO team_memberships (team_id,user_id,status,invited_by_user_id) VALUES ($1,$2,'benched',$3)", [ids.teamA, ids.shared, ids.captainA]);
      const competingMembership = membershipB.query("INSERT INTO team_memberships (team_id,user_id,status,invited_by_user_id) VALUES ($1,$2,'active',$3)", [ids.teamB, ids.shared, ids.captainB]).then(() => { throw new Error("同一用户即使在原队伍为 benched，也不能同时进入第二支长期队伍。"); }, (error: { code?: string }) => {
        if (error.code !== "23505") throw error;
      });
      await membershipA.query("COMMIT");
      await competingMembership;
      await membershipB.query("ROLLBACK");
    } finally { membershipA.release(); membershipB.release(); }

    const executor = drizzle(pool, { schema });
    const representativeTransfer = await executor.transaction((tx) => transferCompetitionEntryRepresentativeInTx(tx, {
      entryId: ids.entryA,
      userId: ids.captainA,
      toUserId: ids.shared,
      actorId: "local-test",
    }));
    if (!representativeTransfer.seasonSlug) throw new Error("CompetitionEntry representative transfer 没有返回赛事上下文。");
    const representativeFacts = await setup.query<{ representative_user_id: string; from_user_id: string | null; to_user_id: string; audits: string }>(`
      SELECT entry.representative_user_id,
        change.from_user_id,
        change.to_user_id,
        (SELECT count(*)::text FROM audit_logs audit WHERE audit.action = 'competition_entry.representative.transfer' AND audit.target_id = entry.id::text) AS audits
      FROM competition_entries entry
      JOIN competition_entry_representative_changes change
        ON change.id = (SELECT id FROM competition_entry_representative_changes WHERE entry_id = entry.id ORDER BY changed_at DESC, id DESC LIMIT 1)
      WHERE entry.id = $1
    `, [ids.entryA]);
    if (representativeFacts.rows[0]?.representative_user_id !== ids.shared || representativeFacts.rows[0]?.from_user_id !== ids.captainA || representativeFacts.rows[0]?.to_user_id !== ids.shared || representativeFacts.rows[0]?.audits !== "1") {
      throw new Error("CompetitionEntry representative transfer 没有原子收敛 pointer、append-only history 与 audit。");
    }

    await setup.query("BEGIN");
    const captainMembershipInvariant = await capturePostgresError(setup, async () => {
      await setup.query("UPDATE team_memberships SET status = 'left', ended_at = now(), ended_reason = 'left' WHERE team_id = $1 AND user_id = $2 AND ended_at IS NULL", [ids.teamA, ids.captainA]);
      await setup.query("SET CONSTRAINTS ALL IMMEDIATE");
    });
    expect(captainMembershipInvariant).toMatchObject({ code: "23514" });

    const crossEntryActiveClaim = await capturePostgresError(setup, async () => {
      await setup.query("DELETE FROM competition_entry_active_claims WHERE participant_id = $1", [ids.participantA]);
      await setup.query("INSERT INTO competition_entry_active_claims (competition_id,user_id,entry_id,participant_id) VALUES ($1,$2,$3,$4)", [ids.season, ids.shared, ids.entryA, ids.participantB]);
    });
    expect(crossEntryActiveClaim).toMatchObject({ code: "23514" });

    const crossEntryCurrentRevision = await capturePostgresError(setup, async () => {
      await setup.query("UPDATE competition_entries SET current_roster_revision_id = $2 WHERE id = $1", [ids.entryA, ids.revisionB]);
      await setup.query("SET CONSTRAINTS ALL IMMEDIATE");
    });
    expect(crossEntryCurrentRevision).toMatchObject({ code: "23503" });

    const unapprovedRevisionPointer = await capturePostgresError(setup, async () => {
      await setup.query("UPDATE competition_entries SET approved_roster_revision_id = $2 WHERE id = $1", [ids.entryA, ids.revisionA]);
      await setup.query("SET CONSTRAINTS ALL IMMEDIATE");
    });
    expect(unapprovedRevisionPointer).toMatchObject({ code: "23514" });

    const staleCurrentRevision = await capturePostgresError(setup, async () => {
      await setup.query("INSERT INTO competition_entry_roster_revisions (id,entry_id,revision_number,status,created_by) VALUES ($1,$2,2,'draft','local-test')", [ids.revisionA2, ids.entryA]);
      await setup.query("SET CONSTRAINTS ALL IMMEDIATE");
    });
    expect(staleCurrentRevision).toMatchObject({ code: "23514" });

    const staleEventRosterSource = await capturePostgresError(setup, async () => {
      await setup.query("INSERT INTO competition_entry_roster_revisions (id,entry_id,revision_number,status,created_by,approved_at) VALUES ($1,$2,2,'approved','local-test',now())", [ids.revisionA2, ids.entryA]);
      await setup.query("UPDATE competition_entries SET current_roster_revision_id = $2, approved_roster_revision_id = $2 WHERE id = $1", [ids.entryA, ids.revisionA2]);
      await setup.query("UPDATE event_rosters SET status = 'confirmed', confirmed_at = now(), confirmed_by = 'local-test' WHERE id = $1", [ids.rosterA]);
      await setup.query("SET CONSTRAINTS ALL IMMEDIATE");
    });
    expect(staleEventRosterSource).toMatchObject({ code: "23514" });

    const crossEntryRosterMember = await capturePostgresError(setup, () => setup.query("INSERT INTO competition_entry_roster_members (revision_id,participant_id,user_id) VALUES ($1,$2,$3)", [ids.revisionA, ids.participantB, ids.shared]));
    expect(crossEntryRosterMember).toMatchObject({ code: "23514" });
    await setup.query("INSERT INTO event_roster_members (id,event_roster_id,participant_id,user_id) VALUES ($1,$2,$3,$4)", [ids.eventMemberA, ids.rosterA, ids.participantA, ids.shared]);
    await setup.query("INSERT INTO event_roster_members (id,event_roster_id,participant_id,user_id) VALUES ($1,$2,$3,$4)", [ids.eventMemberB, ids.rosterB, ids.participantB, ids.shared]);
    await setup.query("INSERT INTO matches (id,season_id,entry_a_id,entry_b_id,stage) VALUES ($1,$2,$3,$4,'fixture')", [ids.match, ids.season, ids.entryA, ids.entryB]);
    await setup.query("INSERT INTO match_rosters (id,match_id,entry_id,source,status) VALUES ($1,$2,$3,'admin_select','submitted')", [ids.matchRoster, ids.match, ids.entryA]);
    const crossEntryMatchPlayer = await capturePostgresError(setup, () => setup.query("INSERT INTO match_roster_players (roster_id,event_roster_member_id) VALUES ($1,$2)", [ids.matchRoster, ids.eventMemberB]));
    expect(crossEntryMatchPlayer).toMatchObject({ code: "23514" });
    await setup.query("INSERT INTO match_roster_players (roster_id,event_roster_member_id) VALUES ($1,$2)", [ids.matchRoster, ids.eventMemberA]);
    await setup.query("UPDATE event_rosters SET status = 'confirmed', confirmed_at = now(), confirmed_by = 'local-test' WHERE id = $1", [ids.rosterA]);
    await setup.query("UPDATE event_rosters SET status = 'preparing', confirmed_at = NULL, confirmed_by = NULL, frozen_at = NULL, frozen_by = NULL WHERE id = $1", [ids.rosterA]);
    await setup.query("UPDATE event_rosters SET status = 'confirmed', confirmed_at = now(), confirmed_by = 'local-test' WHERE id = $1", [ids.rosterA]);
    await setup.query("UPDATE event_rosters SET status = 'frozen', confirmed_at = now(), confirmed_by = 'local-test', frozen_at = now(), frozen_by = 'local-test' WHERE id = $1", [ids.rosterA]);
    const frozenRosterMemberDelete = await capturePostgresError(setup, () => setup.query("DELETE FROM event_roster_members WHERE event_roster_id = $1", [ids.rosterA]));
    expect(frozenRosterMemberDelete).toMatchObject({ code: "23514" });
    const frozenRosterReopen = await capturePostgresError(setup, () => setup.query("UPDATE event_rosters SET status = 'preparing' WHERE id = $1", [ids.rosterA]));
    expect(frozenRosterReopen).toMatchObject({ code: "23514" });
    await setup.query("ROLLBACK");
  } finally {
    try {
      await setup.query("BEGIN");
      await setup.query("SET LOCAL session_replication_role = replica");
      await setup.query("DELETE FROM competition_entry_active_claims WHERE competition_id = $1", [ids.season]);
      await setup.query("DELETE FROM event_roster_members WHERE event_roster_id IN ($1,$2)", [ids.rosterA, ids.rosterB]);
      await setup.query("DELETE FROM event_rosters WHERE id IN ($1,$2)", [ids.rosterA, ids.rosterB]);
      await setup.query("DELETE FROM competition_entry_roster_members WHERE revision_id IN ($1,$2,$3)", [ids.revisionA, ids.revisionB, ids.revisionA2]);
      await setup.query("DELETE FROM competition_entry_roster_revisions WHERE id IN ($1,$2,$3)", [ids.revisionA, ids.revisionB, ids.revisionA2]);
      await setup.query("DELETE FROM competition_entry_participants WHERE entry_id IN ($1,$2)", [ids.entryA, ids.entryB]);
      await setup.query("DELETE FROM competition_entry_representative_changes WHERE entry_id IN ($1,$2)", [ids.entryA, ids.entryB]);
      await setup.query("DELETE FROM competition_entries WHERE id IN ($1,$2)", [ids.entryA, ids.entryB]);
      await setup.query("DELETE FROM team_captain_changes WHERE team_id IN ($1,$2)", [ids.teamA, ids.teamB]);
      await setup.query("DELETE FROM team_name_changes WHERE team_id IN ($1,$2)", [ids.teamA, ids.teamB]);
      await setup.query("DELETE FROM team_memberships WHERE team_id IN ($1,$2)", [ids.teamA, ids.teamB]);
      await setup.query("DELETE FROM teams WHERE id IN ($1,$2)", [ids.teamA, ids.teamB]);
      await setup.query("DELETE FROM seasons WHERE id = $1", [ids.season]);
      await setup.query("DELETE FROM users WHERE id IN ($1,$2,$3)", [ids.shared, ids.captainA, ids.captainB]);
      await setup.query("COMMIT");
    } finally {
      setup.release();
    }
  }
}

/**
 * Combined acceptance against the real 0020 built-in catalog (no mock
 * S23/S24): a non-star A++ member, an S-tier member with exact stars and a
 * legacy S member whose stars stayed NULL must all reach competitive
 * readiness, while an off-ladder rank fails the published mapping. The
 * canonical qualification evaluator owns every stars decision — the
 * CompetitionEntry UI only consumes readiness props.
 */
async function exerciseQualificationWithRealCatalog(pool: Pool): Promise<void> {
  const perfect = BUILT_IN_COMPETITIVE_PLATFORMS.perfect_world;
  const config = {
    platform: perfect.key,
    currentSeasonKey: "2026s2",
    previousSeasonKey: "2026s1",
    rankOrder: perfect.ranks.map((rank) => rank.rankKey),
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // The built-in catalog comes from migration 0020 itself; the fixture must
    // consume it, never re-seed or alias it.
    const seasons = await client.query<{ season_key: string; is_current: boolean }>(
      "SELECT season_key, is_current FROM competitive_platform_seasons WHERE platform = 'perfect_world' ORDER BY sort_order",
    );
    if (JSON.stringify(seasons.rows) !== JSON.stringify([{ season_key: "2026s1", is_current: false }, { season_key: "2026s2", is_current: true }])) {
      throw new Error(`0020 内置 Perfect 赛季目录不符：${JSON.stringify(seasons.rows)}`);
    }
    const demonKing = await client.query<{ star_min: number | null; star_max: number | null }>(
      "SELECT star_min, star_max FROM competitive_platform_ranks WHERE platform_key = 'perfect_world' AND rank_key = '魔王S'",
    );
    if (demonKing.rows[0]?.star_min !== 50 || demonKing.rows[0]?.star_max !== null) {
      throw new Error(`0020 魔王S 星数区间不符：${JSON.stringify(demonKing.rows[0])}`);
    }

    const users = { normal: randomUUID(), star: randomUUID(), legacy: randomUUID(), offLadder: randomUUID() };
    const values: Array<[string, string, string, string, number | null]> = [];
    for (const [key, rank] of [["normal", "A++"], ["star", "魔王S"], ["legacy", "黄金S"], ["offLadder", "Grandmaster"]] as const) {
      // Only the star member carries the post-#293 exact-stars fact shape; the
      // legacy member is the pre-stars shape (S rank, stars NULL).
      values.push([users[key], `${key}-${users[key]}@local.test`, rank, rank, key === "star" ? 50 : null]);
    }
    for (const [id, email] of values) {
      await client.query(
        `INSERT INTO users (id, email, display_name, steam64, perfect_name, qq, email_verified_at)
         VALUES ($1, $2, '选手', '76561198000000001', $3, '100000001', now())`,
        [id, email, `pw-${id}`],
      );
    }
    for (const [id, , historical, current, stars] of values) {
      await client.query(
        `INSERT INTO competitive_rank_facts (user_id, platform, kind, platform_season_key, rank, rating, stars)
         VALUES ($1, 'perfect_world', 'historical_peak', NULL, $2, 1500, $4),
                ($1, 'perfect_world', 'season_peak', '2026s1', $2, 1400, $4),
                ($1, 'perfect_world', 'season_peak', '2026s2', $3, 1600, $4)`,
        [id, historical, current, stars],
      );
    }
    // The legacy member is the pre-stars fact shape: rank on the ladder, stars NULL.
    const legacyStars = await client.query<{ stars: number | null }>(
      "SELECT stars FROM competitive_rank_facts WHERE user_id = $1 AND rank = '黄金S' LIMIT 1",
      [users.legacy],
    );
    if (legacyStars.rows[0]?.stars !== null) throw new Error("legacy fixture 必须保持 stars NULL。");
    const starStars = await client.query<{ stars: number | null }>(
      "SELECT stars FROM competitive_rank_facts WHERE user_id = $1 AND rank = '魔王S' LIMIT 1",
      [users.star],
    );
    if (starStars.rows[0]?.stars !== 50) throw new Error("S 段 fixture 必须带精确星数。");

    // An already published Major retains exactly this context for registration-time use.
    const seasonId = randomUUID();
    await client.query(
      `INSERT INTO seasons (id, slug, name, kind, status, registration_mode, min_team_size, max_team_size, team_registration_config)
       VALUES ($1, $2, 'Local 2026 Catalog Major', 'Major', 'registration', 'team', 1, 5, $3::json)`,
      [seasonId, `local-2026-catalog-${seasonId}`, JSON.stringify({ requireCompetitiveProfile: true, competitiveProfile: config })],
    );
    const frozen = await client.query<{ config: { competitiveProfile: typeof config } }>(
      "SELECT team_registration_config AS config FROM seasons WHERE id = $1",
      [seasonId],
    );
    if (JSON.stringify(frozen.rows[0]?.config.competitiveProfile) !== JSON.stringify(config)) {
      throw new Error("真实 2026 catalog 的冻结 competitiveProfile 必须原样保留。");
    }

    const executor = drizzle(client, { schema });
    const factRows = await loadParticipantQualificationFacts(Object.values(users), { executor });
    for (const [key, userId] of Object.entries(users)) {
      const readiness = computeParticipantReadiness(factRows.get(userId)!, config);
      if (key === "offLadder") {
        if (readiness.strength && readiness.blockers.every((blocker) => !blocker.includes("申报段位不在本赛事公布的段位映射中"))) {
          throw new Error("不在公布段位映射中的 rank 必须被 canonical evaluator 拒绝。");
        }
        continue;
      }
      if (readiness.blockers.some((blocker) => /段位|赛季/.test(blocker))) {
        throw new Error(`${key} 成员不应出现竞技 blocker：${JSON.stringify(readiness.blockers)}`);
      }
      if (!readiness.strength || readiness.strength.historicalPeak === null) {
        throw new Error(`${key} 成员的 strength 输入缺失 historicalPeak。`);
      }
    }
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
}

describe("team registration PostgreSQL invariants", () => {
  it("keeps commitment, roster, qualification, and privacy boundaries intact", async () => {
    await main();
  });
});

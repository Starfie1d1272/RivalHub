import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

const databaseUrl = process.env.RIVALHUB_LOCAL_DATABASE_URL;
if (!databaseUrl) throw new Error("RIVALHUB_LOCAL_DATABASE_URL 未设置。");
const target = new URL(databaseUrl);
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.hostname)) {
  throw new Error("报名集成测试只允许 Local Supabase loopback 数据库。");
}

async function expectsPgError(client: PoolClient, work: () => Promise<unknown>, code: string): Promise<void> {
  await client.query("SAVEPOINT expected_error");
  try { await work(); } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT expected_error");
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === code) return;
    throw error;
  }
  throw new Error(`预期 PostgreSQL 错误 ${code}，但操作成功。`);
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 5 });
  const client = await pool.connect();
  const ids = { season: randomUUID(), captain: randomUUID(), member: randomUUID(), team: randomUUID(), entry: randomUUID(), participant: randomUUID(), revision: randomUUID(), roster: randomUUID() };
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)", [ids.captain, `captain-${ids.captain}@local.test`, ids.member, `member-${ids.member}@local.test`]);
    await client.query("INSERT INTO seasons (id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft, min_team_size, max_team_size) VALUES ($1, $2, 'Local Entry Registration', 'Major', 'registration', 'team', false, false, 2, 5)", [ids.season, `local-entry-${ids.season}`]);
    await client.query("INSERT INTO teams (id, slug, name, creator_user_id, captain_user_id) VALUES ($1, $2, 'Long-lived Local Team', $3, $3)", [ids.team, `local-team-${ids.team.slice(0, 8)}`, ids.captain]);
    await client.query("INSERT INTO team_memberships (team_id, user_id, role, status, invited_by_user_id) VALUES ($1, $2, 'captain', 'active', $2), ($1, $3, 'member', 'active', $2)", [ids.team, ids.captain, ids.member]);
    await client.query("INSERT INTO team_captain_tenures (team_id, user_id, transferred_by) VALUES ($1, $2, 'local-test')", [ids.team, ids.captain]);
    const createdCaptain = await client.query<{ captain_user_id: string; membership_captain: string; tenure_captain: string }>(`
      SELECT t.captain_user_id,
        (SELECT user_id FROM team_memberships WHERE team_id = t.id AND role = 'captain' AND ended_at IS NULL) AS membership_captain,
        (SELECT user_id FROM team_captain_tenures WHERE team_id = t.id AND ended_at IS NULL) AS tenure_captain
      FROM teams t WHERE t.id = $1`, [ids.team]);
    if (!createdCaptain.rows[0] || Object.values(createdCaptain.rows[0]).some((value) => value !== ids.captain)) throw new Error("长期 Team 创建没有同时建立队长三份投影。");
    await client.query("UPDATE team_captain_tenures SET ended_at = now() WHERE team_id = $1 AND ended_at IS NULL", [ids.team]);
    await client.query("UPDATE team_memberships SET role = 'member' WHERE team_id = $1 AND user_id = $2 AND ended_at IS NULL", [ids.team, ids.captain]);
    await client.query("UPDATE team_memberships SET role = 'captain' WHERE team_id = $1 AND user_id = $2 AND ended_at IS NULL", [ids.team, ids.member]);
    await client.query("UPDATE teams SET captain_user_id = $2 WHERE id = $1", [ids.team, ids.member]);
    await client.query("INSERT INTO team_captain_tenures (team_id, user_id, started_at, transferred_by) VALUES ($1, $2, now() + interval '1 millisecond', 'local-test')", [ids.team, ids.member]);
    const transferredCaptain = await client.query<{ captain_user_id: string; membership_captain: string; tenure_captain: string }>(`
      SELECT t.captain_user_id,
        (SELECT user_id FROM team_memberships WHERE team_id = t.id AND role = 'captain' AND ended_at IS NULL) AS membership_captain,
        (SELECT user_id FROM team_captain_tenures WHERE team_id = t.id AND ended_at IS NULL) AS tenure_captain
      FROM teams t WHERE t.id = $1`, [ids.team]);
    if (!transferredCaptain.rows[0] || Object.values(transferredCaptain.rows[0]).some((value) => value !== ids.member)) throw new Error("队长交接没有原子收敛三份投影。");
    await client.query("UPDATE team_captain_tenures SET ended_at = now() WHERE team_id = $1 AND ended_at IS NULL", [ids.team]);
    await client.query("UPDATE team_memberships SET status = 'left', role = 'member', ended_at = now(), ended_reason = 'disbanded' WHERE team_id = $1 AND ended_at IS NULL", [ids.team]);
    await client.query("UPDATE teams SET status = 'disbanded', disbanded_at = now(), disbanded_by = 'local-test' WHERE id = $1", [ids.team]);
    const disbanded = await client.query<{ current_tenures: string; current_members: string; status: string }>(`
      SELECT t.status::text,
        (SELECT count(*)::text FROM team_captain_tenures WHERE team_id = t.id AND ended_at IS NULL) AS current_tenures,
        (SELECT count(*)::text FROM team_memberships WHERE team_id = t.id AND ended_at IS NULL) AS current_members
      FROM teams t WHERE t.id = $1`, [ids.team]);
    if (disbanded.rows[0]?.status !== "disbanded" || disbanded.rows[0]?.current_tenures !== "0" || disbanded.rows[0]?.current_members !== "0") throw new Error("解散没有完整结束队长与成员历史周期。");
    await client.query("INSERT INTO competition_entries (id, competition_id, source, team_id, name, representative_user_id, registration_status) VALUES ($1, $2, 'linked_team', $3, 'Long-lived Local Team', $4, 'draft')", [ids.entry, ids.season, ids.team, ids.captain]);
    await client.query("INSERT INTO competition_entry_participants (id, entry_id, user_id, status, confirmed_at, invited_by_user_id) VALUES ($1, $2, $3, 'confirmed', now(), $3)", [ids.participant, ids.entry, ids.captain]);
    await client.query("INSERT INTO competition_entry_roster_revisions (id, entry_id, revision, status, created_by) VALUES ($1, $2, 1, 'draft', 'local-test')", [ids.revision, ids.entry]);
    await client.query("INSERT INTO competition_entry_roster_members (revision_id, participant_id, user_id, is_primary_starter) VALUES ($1, $2, $3, true)", [ids.revision, ids.participant, ids.captain]);
    await client.query("INSERT INTO event_rosters (id, entry_id, source_roster_revision_id, status) VALUES ($1, $2, $3, 'preparing')", [ids.roster, ids.entry, ids.revision]);
    await client.query("INSERT INTO event_roster_members (event_roster_id, participant_id, user_id, is_primary_starter) VALUES ($1, $2, $3, true)", [ids.roster, ids.participant, ids.captain]);
    const facts = await client.query<{ entries: string; commitments: string; frozen_members: string }>("SELECT (SELECT count(*) FROM competition_entries WHERE id = $1) entries, (SELECT count(*) FROM competition_entry_participants WHERE entry_id = $1) commitments, (SELECT count(*) FROM event_roster_members WHERE event_roster_id = $2) frozen_members", [ids.entry, ids.roster]);
    if (facts.rows[0]?.entries !== "1" || facts.rows[0]?.commitments !== "1" || facts.rows[0]?.frozen_members !== "1") throw new Error("报名、成员确认与赛事名单未分别持久化。");
    await expectsPgError(client, () => client.query("INSERT INTO competition_entries (competition_id, source, team_id, name, representative_user_id) VALUES ($1, 'event_native', $2, 'invalid', $3)", [ids.season, ids.team, ids.captain]), "23514");
    await client.query("SET LOCAL ROLE authenticated");
    await expectsPgError(client, () => client.query("SELECT id FROM competition_entries LIMIT 1"), "42501");
    await client.query("RESET ROLE");
    await client.query("ROLLBACK");
    await exerciseConcurrencyAndInvariants(pool);
    console.log("CompetitionEntry local integration passed: commitment race, active Team and captain projection invariants, frozen roster immutability, cross-Entry rejection, Entry shape constraint, and Data API denial.");
  } finally { client.release(); await pool.end(); }
}

async function exerciseConcurrencyAndInvariants(pool: Pool): Promise<void> {
  const ids = { season: randomUUID(), shared: randomUUID(), captainA: randomUUID(), captainB: randomUUID(), teamA: randomUUID(), teamB: randomUUID(), entryA: randomUUID(), entryB: randomUUID(), participantA: randomUUID(), participantB: randomUUID(), revisionA: randomUUID(), rosterA: randomUUID() };
  const setup = await pool.connect();
  try {
    await setup.query("BEGIN");
    await setup.query("INSERT INTO users (id, email) VALUES ($1,$2),($3,$4),($5,$6)", [ids.shared, `shared-${ids.shared}@local.test`, ids.captainA, `captain-a-${ids.captainA}@local.test`, ids.captainB, `captain-b-${ids.captainB}@local.test`]);
    await setup.query("INSERT INTO seasons (id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft, min_team_size, max_team_size) VALUES ($1,$2,'Local Entry Race','Major','registration','team',false,false,2,5)", [ids.season, `local-entry-race-${ids.season}`]);
    await setup.query("INSERT INTO teams (id,slug,name,creator_user_id,captain_user_id) VALUES ($1,$2,'Race Team A',$3,$3),($4,$5,'Race Team B',$6,$6)", [ids.teamA, `race-a-${ids.teamA.slice(0, 8)}`, ids.captainA, ids.teamB, `race-b-${ids.teamB.slice(0, 8)}`, ids.captainB]);
    await setup.query("INSERT INTO competition_entries (id,competition_id,source,name,representative_user_id,registration_status) VALUES ($1,$2,'event_native','Entry A',$3,'draft'),($4,$2,'event_native','Entry B',$5,'draft')", [ids.entryA, ids.season, ids.captainA, ids.entryB, ids.captainB]);
    await setup.query("INSERT INTO competition_entry_participants (id,entry_id,user_id,status,invited_by_user_id) VALUES ($1,$2,$3,'invited',$4),($5,$6,$3,'invited',$7)", [ids.participantA, ids.entryA, ids.shared, ids.captainA, ids.participantB, ids.entryB, ids.captainB]);
    await setup.query("INSERT INTO competition_entry_roster_revisions (id,entry_id,revision,status,created_by) VALUES ($1,$2,1,'draft','local-test')", [ids.revisionA, ids.entryA]);
    await setup.query("INSERT INTO event_rosters (id,entry_id,source_roster_revision_id,status) VALUES ($1,$2,$3,'preparing')", [ids.rosterA, ids.entryA, ids.revisionA]);
    await setup.query("COMMIT");

    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query("BEGIN");
      await second.query("BEGIN");
      await first.query("INSERT INTO competition_entry_active_claims (competition_id,user_id,entry_id,participant_id) VALUES ($1,$2,$3,$4)", [ids.season, ids.shared, ids.entryA, ids.participantA]);
      await first.query("UPDATE competition_entry_participants SET status = 'confirmed', confirmed_at = now() WHERE id = $1", [ids.participantA]);
      const competingClaim = second.query("INSERT INTO competition_entry_active_claims (competition_id,user_id,entry_id,participant_id) VALUES ($1,$2,$3,$4)", [ids.season, ids.shared, ids.entryB, ids.participantB]);
      await first.query("COMMIT");
      await competingClaim.then(() => { throw new Error("同一用户同时确认两个 Entry 不应成功。"); }, (error: { code?: string }) => {
        if (error.code !== "23505") throw error;
      });
      await second.query("ROLLBACK");
    } finally { first.release(); second.release(); }
    const claims = await setup.query<{ count: string }>("SELECT count(*) FROM competition_entry_active_claims WHERE competition_id = $1 AND user_id = $2", [ids.season, ids.shared]);
    if (claims.rows[0]?.count !== "1") throw new Error("active commitment race 没有收敛为唯一 claim。");

    const membershipA = await pool.connect();
    const membershipB = await pool.connect();
    try {
      await membershipA.query("BEGIN");
      await membershipB.query("BEGIN");
      await membershipA.query("INSERT INTO team_memberships (team_id,user_id,status,role,invited_by_user_id) VALUES ($1,$2,'active','member',$3)", [ids.teamA, ids.shared, ids.captainA]);
      const competingMembership = membershipB.query("INSERT INTO team_memberships (team_id,user_id,status,role,invited_by_user_id) VALUES ($1,$2,'active','member',$3)", [ids.teamB, ids.shared, ids.captainB]);
      await membershipA.query("COMMIT");
      await competingMembership.then(() => { throw new Error("同一用户同时接受两个长期队伍邀请不应成功。"); }, (error: { code?: string }) => {
        if (error.code !== "23505") throw error;
      });
      await membershipB.query("ROLLBACK");
    } finally { membershipA.release(); membershipB.release(); }

    await setup.query("BEGIN");
    await expectsPgError(setup, () => setup.query("INSERT INTO competition_entry_roster_members (revision_id,participant_id,user_id) VALUES ($1,$2,$3)", [ids.revisionA, ids.participantB, ids.shared]), "23514");
    await setup.query("INSERT INTO event_roster_members (event_roster_id,participant_id,user_id) VALUES ($1,$2,$3)", [ids.rosterA, ids.participantA, ids.shared]);
    await setup.query("UPDATE event_rosters SET status = 'confirmed' WHERE id = $1", [ids.rosterA]);
    await setup.query("UPDATE event_rosters SET status = 'preparing' WHERE id = $1", [ids.rosterA]);
    await setup.query("UPDATE event_rosters SET status = 'confirmed' WHERE id = $1", [ids.rosterA]);
    await setup.query("UPDATE event_rosters SET status = 'frozen', frozen_at = now(), frozen_by = 'local-test' WHERE id = $1", [ids.rosterA]);
    await expectsPgError(setup, () => setup.query("DELETE FROM event_roster_members WHERE event_roster_id = $1", [ids.rosterA]), "23514");
    await expectsPgError(setup, () => setup.query("UPDATE event_rosters SET status = 'preparing' WHERE id = $1", [ids.rosterA]), "23514");
    await setup.query("ROLLBACK");
  } finally {
    await setup.query("DELETE FROM competition_entry_active_claims WHERE competition_id = $1", [ids.season]);
    await setup.query("DELETE FROM event_roster_members WHERE event_roster_id = $1", [ids.rosterA]);
    await setup.query("DELETE FROM event_rosters WHERE id = $1", [ids.rosterA]);
    await setup.query("DELETE FROM competition_entry_roster_revisions WHERE id = $1", [ids.revisionA]);
    await setup.query("DELETE FROM competition_entry_participants WHERE entry_id IN ($1,$2)", [ids.entryA, ids.entryB]);
    await setup.query("DELETE FROM competition_entries WHERE id IN ($1,$2)", [ids.entryA, ids.entryB]);
    await setup.query("DELETE FROM team_memberships WHERE team_id IN ($1,$2)", [ids.teamA, ids.teamB]);
    await setup.query("DELETE FROM teams WHERE id IN ($1,$2)", [ids.teamA, ids.teamB]);
    await setup.query("DELETE FROM seasons WHERE id = $1", [ids.season]);
    await setup.query("DELETE FROM users WHERE id IN ($1,$2,$3)", [ids.shared, ids.captainA, ids.captainB]);
    setup.release();
  }
}

void main();

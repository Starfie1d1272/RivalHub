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
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 1 });
  const client = await pool.connect();
  const ids = { season: randomUUID(), captain: randomUUID(), member: randomUUID(), team: randomUUID(), entry: randomUUID(), participant: randomUUID(), revision: randomUUID(), roster: randomUUID() };
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)", [ids.captain, `captain-${ids.captain}@local.test`, ids.member, `member-${ids.member}@local.test`]);
    await client.query("INSERT INTO seasons (id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft, min_team_size, max_team_size) VALUES ($1, $2, 'Local Entry Registration', 'Major', 'registration', 'team', false, false, 2, 5)", [ids.season, `local-entry-${ids.season}`]);
    await client.query("INSERT INTO teams (id, slug, name, creator_user_id, captain_user_id) VALUES ($1, $2, 'Long-lived Local Team', $3, $3)", [ids.team, `local-team-${ids.team.slice(0, 8)}`, ids.captain]);
    await client.query("INSERT INTO team_memberships (team_id, user_id, role, status, invited_by_user_id) VALUES ($1, $2, 'captain', 'active', $2), ($1, $3, 'member', 'active', $2)", [ids.team, ids.captain, ids.member]);
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
    console.log("CompetitionEntry local integration passed: long-lived Team, commitment, event roster, Entry shape constraint, and Data API denial.");
  } finally { client.release(); await pool.end(); }
}

void main();

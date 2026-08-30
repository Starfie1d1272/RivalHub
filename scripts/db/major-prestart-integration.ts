import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

const databaseUrl = process.env.RIVALHUB_LOCAL_DATABASE_URL;
if (!databaseUrl) throw new Error("RIVALHUB_LOCAL_DATABASE_URL 未设置。");
const target = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname)) throw new Error("Major 赛前集成测试只允许 Local Supabase loopback 数据库。");

async function expectPgError(client: PoolClient, work: () => Promise<unknown>, code: string): Promise<void> {
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
  const seasonId = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO seasons (id,slug,name,kind,status,registration_mode,has_captain_voting,has_draft,min_team_size,max_team_size) VALUES ($1,$2,'Local Major Prestart','Major','registration','team',false,false,1,5)", [seasonId, `local-major-prestart-${seasonId}`]);
    await client.query("INSERT INTO major_prestart_states (season_id) VALUES ($1)", [seasonId]);
    const entrantIds: string[] = [];
    for (let index = 0; index < 32; index += 1) {
      const entrantId = randomUUID(); const userId = randomUUID(); const entryId = randomUUID(); const participantId = randomUUID(); const revisionId = randomUUID(); const eventRosterId = randomUUID();
      entrantIds.push(entrantId);
      await client.query("INSERT INTO users (id,email) VALUES ($1,$2)", [userId, `prestart-${index}-${seasonId}@local.test`]);
      await client.query("INSERT INTO competition_entries (id,competition_id,source,name,representative_user_id,registration_status,approved_roster_revision) VALUES ($1,$2,'event_native',$3,$4,'approved',1)", [entryId, seasonId, `Entry ${index + 1}`, userId]);
      await client.query("INSERT INTO competition_entry_participants (id,entry_id,user_id,status,confirmed_at,invited_by_user_id) VALUES ($1,$2,$3,'confirmed',now(),$3)", [participantId, entryId, userId]);
      await client.query("INSERT INTO competition_entry_roster_revisions (id,entry_id,revision,status,created_by,approved_at) VALUES ($1,$2,1,'approved','local-test',now())", [revisionId, entryId]);
      await client.query("INSERT INTO competition_entry_roster_members (revision_id,participant_id,user_id,is_primary_starter) VALUES ($1,$2,$3,true)", [revisionId, participantId, userId]);
      await client.query("INSERT INTO event_rosters (id,entry_id,source_roster_revision_id,status) VALUES ($1,$2,$3,'preparing')", [eventRosterId, entryId, revisionId]);
      await client.query("INSERT INTO event_roster_members (event_roster_id,participant_id,user_id,is_primary_starter) VALUES ($1,$2,$3,true)", [eventRosterId, participantId, userId]);
      await client.query("INSERT INTO major_prestart_entrants (id,season_id,competition_entry_id,event_roster_id) VALUES ($1,$2,$3,$4)", [entrantId, seasonId, entryId, eventRosterId]);
    }
    const first = entrantIds[0]!;
    const firstRoster = await client.query<{ event_roster_id: string }>("SELECT event_roster_id FROM major_prestart_entrants WHERE id = $1", [first]);
    const rosterId = firstRoster.rows[0]!.event_roster_id;
    await client.query("UPDATE event_rosters SET status = 'confirmed' WHERE id = $1", [rosterId]);
    await client.query("UPDATE major_prestart_entrants SET roster_confirmed_at = now(), roster_confirmed_by = 'local-test' WHERE id = $1", [first]);
    await client.query("UPDATE event_rosters SET status = 'preparing' WHERE id = $1", [rosterId]);
    await client.query("UPDATE major_prestart_entrants SET roster_confirmed_at = NULL, roster_confirmed_by = NULL WHERE id = $1", [first]);
    await client.query("UPDATE event_roster_members SET is_primary_starter = false WHERE event_roster_id = $1", [rosterId]);
    await client.query("UPDATE event_rosters SET status = 'confirmed' WHERE id IN (SELECT event_roster_id FROM major_prestart_entrants WHERE season_id = $1)", [seasonId]);
    await client.query("UPDATE major_prestart_entrants SET roster_confirmed_at = now(), roster_confirmed_by = 'local-test' WHERE season_id = $1", [seasonId]);
    await client.query("UPDATE event_rosters SET status = 'frozen', frozen_at = now(), frozen_by = 'local-test' WHERE id IN (SELECT event_roster_id FROM major_prestart_entrants WHERE season_id = $1)", [seasonId]);
    await client.query("UPDATE major_prestart_states SET entrants_locked_at = now(), entrants_locked_by = 'local-test' WHERE season_id = $1", [seasonId]);
    await expectPgError(client, () => client.query("UPDATE event_roster_members SET is_primary_starter = true WHERE event_roster_id = $1", [rosterId]), "23514");
    await expectPgError(client, () => client.query("UPDATE event_rosters SET status = 'preparing' WHERE id = $1", [rosterId]), "23514");
    const frozen = await client.query<{ rosters: string; locked: boolean }>("SELECT (SELECT count(*)::text FROM event_rosters WHERE id IN (SELECT event_roster_id FROM major_prestart_entrants WHERE season_id = $1) AND status = 'frozen') AS rosters, (SELECT entrants_locked_at IS NOT NULL FROM major_prestart_states WHERE season_id = $1) AS locked", [seasonId]);
    if (frozen.rows[0]?.rosters !== "32" || !frozen.rows[0]?.locked) throw new Error("Major 全局锁定没有冻结全部 32 支赛事名单。");
    await client.query("ROLLBACK");
    console.log("Major prestart local integration passed: prepare → confirm → reopen → edit → confirm → global lock → frozen, with post-lock roster mutation rejection.");
  } finally { client.release(); await pool.end(); }
}

void main().catch((error) => { console.error(error); process.exit(1); });

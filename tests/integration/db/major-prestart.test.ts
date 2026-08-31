import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { assertPrestartEntryCoherenceInTx } from "../../../src/lib/major/prestart-entry";
import { ErrorCode } from "../../../src/lib/errors";
import { capturePostgresError, localDatabaseUrl } from "./harness/database";

const databaseUrl = localDatabaseUrl();

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
      await client.query("INSERT INTO competition_entries (id,competition_id,source,name,representative_user_id,current_roster_revision_id,approved_roster_revision_id,registration_status) VALUES ($1,$2,'event_native',$3,$4,$5,$5,'approved')", [entryId, seasonId, `Entry ${index + 1}`, userId, revisionId]);
      await client.query("INSERT INTO competition_entry_representative_changes (entry_id,from_user_id,to_user_id,changed_by_actor_id) VALUES ($1,NULL,$2,'local-test')", [entryId, userId]);
      await client.query("INSERT INTO competition_entry_participants (id,entry_id,user_id,status,confirmed_at,invited_by_user_id) VALUES ($1,$2,$3,'confirmed',now(),$3)", [participantId, entryId, userId]);
      await client.query("INSERT INTO competition_entry_roster_revisions (id,entry_id,revision_number,status,created_by,approved_at) VALUES ($1,$2,1,'approved','local-test',now())", [revisionId, entryId]);
      await client.query("INSERT INTO competition_entry_roster_members (revision_id,participant_id,user_id,is_primary_starter) VALUES ($1,$2,$3,true)", [revisionId, participantId, userId]);
      await client.query("INSERT INTO event_rosters (id,entry_id,source_roster_revision_id,status) VALUES ($1,$2,$3,'preparing')", [eventRosterId, entryId, revisionId]);
      await client.query("INSERT INTO event_roster_members (event_roster_id,participant_id,user_id,is_primary_starter) VALUES ($1,$2,$3,true)", [eventRosterId, participantId, userId]);
      await client.query("INSERT INTO major_tournament_entrants (id,season_id,competition_entry_id) VALUES ($1,$2,$3)", [entrantId, seasonId, entryId]);
    }
    const first = entrantIds[0]!;
    const firstRoster = await client.query<{ event_roster_id: string }>("SELECT id AS event_roster_id FROM event_rosters WHERE entry_id = (SELECT competition_entry_id FROM major_tournament_entrants WHERE id = $1)", [first]);
    const rosterId = firstRoster.rows[0]!.event_roster_id;
    await client.query("UPDATE event_rosters SET status = 'confirmed', confirmed_at = now(), confirmed_by = 'local-test' WHERE id = $1", [rosterId]);
    await client.query("UPDATE event_rosters SET status = 'preparing', confirmed_at = NULL, confirmed_by = NULL, frozen_at = NULL, frozen_by = NULL WHERE id = $1", [rosterId]);
    await client.query("UPDATE event_roster_members SET is_primary_starter = false WHERE event_roster_id = $1", [rosterId]);
    await client.query("UPDATE event_rosters SET status = 'confirmed', confirmed_at = now(), confirmed_by = 'local-test' WHERE entry_id IN (SELECT competition_entry_id FROM major_tournament_entrants WHERE season_id = $1)", [seasonId]);
    await client.query("UPDATE event_rosters SET status = 'frozen', confirmed_at = now(), confirmed_by = 'local-test', frozen_at = now(), frozen_by = 'local-test' WHERE entry_id IN (SELECT competition_entry_id FROM major_tournament_entrants WHERE season_id = $1)", [seasonId]);
    await client.query("UPDATE major_prestart_states SET entrants_locked_at = now(), entrants_locked_by = 'local-test' WHERE season_id = $1", [seasonId]);
    const frozenMemberMutation = await capturePostgresError(client, () => client.query("UPDATE event_roster_members SET is_primary_starter = true WHERE event_roster_id = $1", [rosterId]));
    expect(frozenMemberMutation).toMatchObject({ code: "23514" });
    const frozenRosterMutation = await capturePostgresError(client, () => client.query("UPDATE event_rosters SET status = 'preparing' WHERE id = $1", [rosterId]));
    expect(frozenRosterMutation).toMatchObject({ code: "23514" });
    const frozen = await client.query<{ rosters: string; locked: boolean }>("SELECT (SELECT count(*)::text FROM event_rosters WHERE entry_id IN (SELECT competition_entry_id FROM major_tournament_entrants WHERE season_id = $1) AND status = 'frozen') AS rosters, (SELECT entrants_locked_at IS NOT NULL FROM major_prestart_states WHERE season_id = $1) AS locked", [seasonId]);
    if (frozen.rows[0]?.rosters !== "32" || !frozen.rows[0]?.locked) throw new Error("Major 全局锁定没有冻结全部 32 支赛事名单。");
    await client.query("ROLLBACK");
    await exerciseEntryCoherenceGuard();
    console.log("Major prestart local integration passed: prepare → confirm → reopen → edit → confirm → global lock → frozen, with post-lock roster mutation rejection and prestart↔Entry coherence guard coverage.");
  } finally { client.release(); await pool.end(); }
}

/**
 * Canonical prestart ↔ CompetitionEntry coherence guard 回归：补正中的 Entry、
 * 指向旧批准版本的 event roster 与破损 invariant 都必须在不可逆边界前 fail closed。
 */
async function exerciseEntryCoherenceGuard(): Promise<void> {
  // 独立连接池：调用方仍持有主 client，且主池 max=1。
  const guardPool = new Pool({ connectionString: databaseUrl, ssl: false, max: 2 });
  const database = drizzle(guardPool, { schema });
  const ids = { season: randomUUID(), entryA: randomUUID(), entryB: randomUUID(), revisionA: randomUUID(), revisionB: randomUUID(), revisionB2: randomUUID(), rosterA: randomUUID(), rosterB: randomUUID(), userA: randomUUID(), userB: randomUUID() };
  const cleanup = async (): Promise<void> => {
    const cleanupClient = await guardPool.connect();
    try {
      await cleanupClient.query("BEGIN");
      await cleanupClient.query("SET LOCAL session_replication_role = replica");
      await cleanupClient.query("DELETE FROM event_rosters WHERE id IN ($1,$2)", [ids.rosterA, ids.rosterB]);
      await cleanupClient.query("DELETE FROM competition_entry_roster_members WHERE revision_id IN ($1,$2,$3)", [ids.revisionA, ids.revisionB, ids.revisionB2]);
      await cleanupClient.query("DELETE FROM competition_entry_roster_revisions WHERE entry_id IN ($1,$2)", [ids.entryA, ids.entryB]);
      await cleanupClient.query("DELETE FROM competition_entry_representative_changes WHERE entry_id IN ($1,$2)", [ids.entryA, ids.entryB]);
      await cleanupClient.query("DELETE FROM competition_entries WHERE id IN ($1,$2)", [ids.entryA, ids.entryB]);
      await cleanupClient.query("DELETE FROM seasons WHERE id = $1", [ids.season]);
      await cleanupClient.query("DELETE FROM users WHERE id IN ($1,$2)", [ids.userA, ids.userB]);
      await cleanupClient.query("COMMIT");
    } catch (error) {
      await cleanupClient.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      cleanupClient.release();
    }
  };
  const setup = await guardPool.connect();
  try {
    await setup.query("BEGIN");
    await setup.query("INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)", [ids.userA, `coherence-a-${ids.userA}@local.test`, ids.userB, `coherence-b-${ids.userB}@local.test`]);
    await setup.query("INSERT INTO seasons (id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft, min_team_size, max_team_size) VALUES ($1, $2, 'Local Coherence Guard', 'Major', 'registration', 'team', false, false, 1, 5)", [ids.season, `local-coherence-${ids.season}`]);
    for (const [entryId, revisionId, rosterId, userId, name] of [
      [ids.entryA, ids.revisionA, ids.rosterA, ids.userA, "Coherence Entry A"],
      [ids.entryB, ids.revisionB, ids.rosterB, ids.userB, "Coherence Entry B"],
    ] as const) {
      await setup.query(
        "INSERT INTO competition_entries (id, competition_id, source, name, representative_user_id, current_roster_revision_id, approved_roster_revision_id, registration_status) VALUES ($1, $2, 'event_native', $3, $4, $5, $5, 'approved')",
        [entryId, ids.season, name, userId, revisionId],
      );
      await setup.query("INSERT INTO competition_entry_representative_changes (entry_id, from_user_id, to_user_id, changed_by_actor_id) VALUES ($1, NULL, $2, 'local-test')", [entryId, userId]);
      await setup.query(
        "INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by, approved_at) VALUES ($1, $2, 1, 'approved', 'local-test', now())",
        [revisionId, entryId],
      );
      await setup.query(
        "INSERT INTO event_rosters (id, entry_id, source_roster_revision_id, status) VALUES ($1, $2, $3, 'preparing')",
        [rosterId, entryId, revisionId],
      );
    }
    await setup.query("COMMIT");
  } catch (error) {
    await setup.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    setup.release();
  }

  try {
    const refs = [
      { competitionEntryId: ids.entryA },
      { competitionEntryId: ids.entryB },
    ];

    // 一致状态通过，并返回正确的绑定事实。
    await database.transaction(async (tx) => {
      const coherent = await assertPrestartEntryCoherenceInTx(tx, ids.season, refs);
      if (coherent.length !== 2 || coherent.some((row) => row.approvedRevision.id !== row.eventRoster.sourceRosterRevisionId)) {
        throw new Error("一致的 prestart 事实应通过 coherence guard。");
      }
    });

    // Case 1：Entry 重新进入补正 → 业务错误 fail closed。
    await guardPool.query("UPDATE competition_entries SET registration_status = 'changes_requested' WHERE id = $1", [ids.entryA]);
    const remediationError = await database.transaction(async (tx) => {
      await assertPrestartEntryCoherenceInTx(tx, ids.season, refs);
    }).catch((error: unknown) => error);
    expect(remediationError).toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    expect(remediationError).toHaveProperty("message", expect.stringContaining("名单补正中"));
    await guardPool.query("UPDATE competition_entries SET registration_status = 'approved' WHERE id = $1", [ids.entryA]);

    // Case 2：新批准 revision 存在但 event roster 未重同步 → 业务错误。
    const revisionTransition = await guardPool.connect();
    try {
      await revisionTransition.query("BEGIN");
      await revisionTransition.query(
        "INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by, approved_at) VALUES ($1, $2, 2, 'approved', 'local-test', now())",
        [ids.revisionB2, ids.entryB],
      );
      await revisionTransition.query("UPDATE competition_entries SET current_roster_revision_id = $2, approved_roster_revision_id = $2 WHERE id = $1", [ids.entryB, ids.revisionB2]);
      await revisionTransition.query("COMMIT");
    } catch (error) {
      await revisionTransition.query("ROLLBACK");
      throw error;
    } finally {
      revisionTransition.release();
    }
    await guardPool.query("UPDATE event_rosters SET source_roster_revision_id = $1 WHERE id = $2", [ids.revisionB, ids.rosterB]);
    const staleRosterError = await database.transaction(async (tx) => {
      await assertPrestartEntryCoherenceInTx(tx, ids.season, refs);
    }).catch((error: unknown) => error);
    expect(staleRosterError).toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    expect(staleRosterError).toHaveProperty("message", expect.stringContaining("重新同步最终名单"));

    // DB invariant：approved pointer 指向的版本不再是 approved → fail closed。
    await guardPool.query("UPDATE event_rosters SET source_roster_revision_id = $1 WHERE id = $2", [ids.revisionB2, ids.rosterB]);
    const brokenRevisionClient = await guardPool.connect();
    let brokenRevisionError: unknown;
    try {
      await brokenRevisionClient.query("BEGIN");
      brokenRevisionError = await capturePostgresError(brokenRevisionClient, async () => {
        await brokenRevisionClient.query("UPDATE competition_entry_roster_revisions SET status = 'superseded' WHERE id = $1", [ids.revisionB2]);
        await brokenRevisionClient.query("SET CONSTRAINTS ALL IMMEDIATE");
      });
      await brokenRevisionClient.query("ROLLBACK");
    } finally {
      brokenRevisionClient.release();
    }
    expect(brokenRevisionError).toMatchObject({ code: "23514" });
  } finally {
    await cleanup();
    await guardPool.end();
  }
}

describe("Major prestart PostgreSQL invariants", () => {
  it("freezes all entrants and rejects post-lock roster drift", async () => {
    await main();
  });
});

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import { localDatabaseUrl } from "./harness/database";

async function main(): Promise<void> {
  const databaseUrl = localDatabaseUrl();
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? databaseUrl;
  const schema = await import("../../../src/db/schema");
  const { addMatchCommentatorInTx, confirmPostMatchReportInTx, submitPostMatchReportInTx } = await import("../../../src/lib/postmatch/service");
  const { resolveCommunityAwardInTx, reviewCommunityAwardInTx, submitCommunityAwardInTx } = await import("../../../src/lib/community-awards/service");
  const pool = new Pool({ connectionString: databaseUrl, ssl: false });
  const db = drizzle(pool, { schema });
  const seasonId = randomUUID();
  const representativeId = randomUUID();
  const commentatorId = randomUUID();
  const confirmerId = randomUUID();
  const outsiderId = randomUUID();
  const entryAId = randomUUID();
  const entryBId = randomUUID();
  const revisionAId = randomUUID();
  const revisionBId = randomUUID();
  const matchId = randomUUID();
  let awardId = "";
  try {
    await pool.query(`INSERT INTO seasons (id, slug, name, kind, status, registration_mode, has_captain_voting, has_draft, commentator_fee_cents)
      VALUES ($1, $2, 'Postmatch local', 'Major', 'playing', 'team', false, false, 500)`, [seasonId, `postmatch-${randomUUID()}`]);
    for (const [id, label] of [[representativeId, "代表"], [commentatorId, "解说"], [confirmerId, "确认人"], [outsiderId, "非管理员"]]) {
      await pool.query("INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)", [id, `${id}@local.test`, label]);
    }
    await pool.query("INSERT INTO season_admin_grants (user_id, season_id) VALUES ($1, $2), ($3, $2)", [commentatorId, seasonId, confirmerId]);
    await pool.query("BEGIN");
    try {
      for (const [entryId, revisionId, name] of [[entryAId, revisionAId, "A 队"], [entryBId, revisionBId, "B 队"]]) {
        await pool.query(`INSERT INTO competition_entries (id, competition_id, source, name, representative_user_id, current_roster_revision_id, registration_status)
          VALUES ($1, $2, 'event_native', $3, $4, $5, 'approved')`, [entryId, seasonId, name, representativeId, revisionId]);
        await pool.query("INSERT INTO competition_entry_representative_changes (entry_id, from_user_id, to_user_id, changed_by_actor_id) VALUES ($1, NULL, $2, 'local')", [entryId, representativeId]);
        await pool.query("INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by) VALUES ($1, $2, 1, 'approved', 'local')", [revisionId, entryId]);
      }
      await pool.query("COMMIT");
    } catch (error) { await pool.query("ROLLBACK"); throw error; }
    await pool.query(`INSERT INTO matches (id, season_id, entry_a_id, entry_b_id, stage, format, status, score_a, score_b, completed_at)
      VALUES ($1, $2, $3, $4, 'final', 'bo1', 'finished', 1, 0, now())`, [matchId, seasonId, entryAId, entryBId]);

    await db.transaction((tx) => addMatchCommentatorInTx(tx, { matchId, userId: commentatorId, actorId: confirmerId }));
    const invalidCommentator = await pool.query("INSERT INTO match_commentators (match_id, user_id, added_by_user_id) VALUES ($1, $2, $3)", [matchId, outsiderId, confirmerId]).then(() => undefined, (error: { code?: string }) => error);
    expect(invalidCommentator?.code).toBe("23514");

    await db.transaction((tx) => submitPostMatchReportInTx(tx, { matchId, actorId: commentatorId }));
    const confirmation = await db.transaction((tx) => confirmPostMatchReportInTx(tx, { matchId, actorId: confirmerId }));
    expect(confirmation.commentatorCount).toBe(1);
    const reportAndFee = await pool.query<{ status: string; fee: number; settled_at: Date | null }>(`SELECT r.status::text AS status, c.confirmed_fee_cents AS fee, c.settled_at
      FROM post_match_reports r JOIN match_commentators c ON c.match_id = r.match_id WHERE r.match_id = $1`, [matchId]);
    expect(reportAndFee.rows[0]).toMatchObject({ status: "confirmed", fee: 500, settled_at: null });
    const removal = await pool.query("DELETE FROM match_commentators WHERE match_id = $1 AND user_id = $2", [matchId, commentatorId]).then(() => undefined, (error: { code?: string }) => error);
    expect(removal?.code).toBe("23514");

    const submitted = await db.transaction((tx) => submitCommunityAwardInTx(tx, { seasonId, submitterId: outsiderId, name: "最佳解说", condition: "根据已确认解说场次评定", prize: "纪念奖品" }));
    awardId = submitted.awardId;
    await db.transaction((tx) => reviewCommunityAwardInTx(tx, { awardId, status: "approved", actorId: confirmerId }));
    await db.transaction((tx) => resolveCommunityAwardInTx(tx, { awardId, status: "awarded", recipientUserId: commentatorId, outcomeNote: "已确认解说场次最高", actorId: confirmerId }));
    const award = await pool.query<{ status: string; recipient_user_id: string }>("SELECT status::text, recipient_user_id FROM community_awards WHERE id = $1", [awardId]);
    const officialHonors = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM tournament_honors WHERE season_id = $1", [seasonId]);
    expect(award.rows[0]).toMatchObject({ status: "awarded", recipient_user_id: commentatorId });
    expect(officialHonors.rows[0]?.count).toBe("0");
    console.log("Postmatch/community awards local integration passed: season-admin commentator guard, distinct confirmation, fee snapshot/settlement guard, and community award outcome remain separate from official honors.");
  } finally {
    const cleanup = await pool.connect();
    try {
      await cleanup.query("BEGIN");
      await cleanup.query("SET LOCAL session_replication_role = replica");
      if (awardId) await cleanup.query("DELETE FROM community_awards WHERE id = $1", [awardId]);
      await cleanup.query("DELETE FROM audit_logs WHERE season_id = $1", [seasonId]);
      await cleanup.query("DELETE FROM post_match_reports WHERE match_id = $1", [matchId]);
      await cleanup.query("DELETE FROM match_commentators WHERE match_id = $1", [matchId]);
      await cleanup.query("DELETE FROM matches WHERE id = $1", [matchId]);
      await cleanup.query("DELETE FROM competition_entry_representative_changes WHERE entry_id = ANY($1::uuid[])", [[entryAId, entryBId]]);
      await cleanup.query("DELETE FROM competition_entry_roster_revisions WHERE id = ANY($1::uuid[])", [[revisionAId, revisionBId]]);
      await cleanup.query("DELETE FROM competition_entries WHERE id = ANY($1::uuid[])", [[entryAId, entryBId]]);
      await cleanup.query("DELETE FROM season_admin_grants WHERE season_id = $1", [seasonId]);
      await cleanup.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[representativeId, commentatorId, confirmerId, outsiderId]]);
      await cleanup.query("DELETE FROM seasons WHERE id = $1", [seasonId]);
      await cleanup.query("COMMIT");
    } catch (error) {
      await cleanup.query("ROLLBACK");
      throw error;
    } finally { cleanup.release(); }
    await pool.end();
  }
}

describe("postmatch and community-award PostgreSQL invariants", () => {
  it("keeps commentator/settlement facts and community awards scoped and separated", async () => {
    await main();
  });
});

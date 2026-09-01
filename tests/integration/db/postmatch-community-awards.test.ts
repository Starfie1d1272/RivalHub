import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import { localDatabaseUrl } from "./harness/database";

describe("postmatch PostgreSQL invariants", () => {
  it("limits commentators, freezes a submitted roster, and derives completion from video", async () => {
    const databaseUrl = localDatabaseUrl(); process.env.DATABASE_URL = process.env.DATABASE_URL ?? databaseUrl;
    const schema = await import("../../../src/db/schema");
    const { addMatchCommentatorInTx, revokePostMatchSubmissionInTx, submitPostMatchReportInTx, setMatchVideoUrlInTx, getPostMatchCompletion } = await import("../../../src/lib/postmatch/service");
    const { applyMatchStatusTransitionInTx } = await import("../../../src/lib/match-rosters/service");
    const { addCommunityAwardEvidenceInTx, requestCommunityAwardSupplementInTx, resolveCommunityAwardInTx, reviewCommunityAwardInTx, reviseCommunityAwardInTx, submitCommunityAwardInTx } = await import("../../../src/lib/community-awards/service");
    const pool = new Pool({ connectionString: databaseUrl, ssl: false }); const db = drizzle(pool, { schema });
    const seasonId = randomUUID(), adminA = randomUUID(), adminB = randomUUID(), adminC = randomUUID(), outsider = randomUUID(), representative = randomUUID(), entryA = randomUUID(), entryB = randomUUID(), revisionA = randomUUID(), revisionB = randomUUID(), matchId = randomUUID(), cancelledMatchId = randomUUID();
    try {
      await pool.query("INSERT INTO seasons (id,slug,name,kind,status,registration_mode,has_captain_voting,has_draft) VALUES ($1,$2,'Postmatch','Major','playing','team',false,false)", [seasonId, `postmatch-${randomUUID()}`]);
      for (const [id, name] of [[adminA, "解说甲"], [adminB, "解说乙"], [adminC, "解说丙"], [outsider, "非管理员"], [representative, "代表"]]) await pool.query("INSERT INTO users (id,email,display_name) VALUES ($1,$2,$3)", [id, `${id}@local.test`, name]);
      await pool.query("INSERT INTO season_admin_grants (user_id,season_id) VALUES ($1,$4),($2,$4),($3,$4)", [adminA, adminB, adminC, seasonId]);
      const entryClient = await pool.connect();
      try {
        await entryClient.query("BEGIN");
        for (const [id, revision, name] of [[entryA, revisionA, "A 队"], [entryB, revisionB, "B 队"]]) { await entryClient.query("INSERT INTO competition_entries (id,competition_id,source,name,representative_user_id,current_roster_revision_id,approved_roster_revision_id,registration_status) VALUES ($1,$2,'event_native',$3,$4,$5,$5,'approved')", [id, seasonId, name, representative, revision]); await entryClient.query("INSERT INTO competition_entry_representative_changes (entry_id,from_user_id,to_user_id,changed_by_actor_id) VALUES ($1,NULL,$2,'local-test')", [id, representative]); await entryClient.query("INSERT INTO competition_entry_roster_revisions (id,entry_id,revision_number,status,created_by,approved_at) VALUES ($1,$2,1,'approved','local-test',now())", [revision, id]); }
        await entryClient.query("COMMIT");
      } catch (error) { await entryClient.query("ROLLBACK"); throw error; } finally { entryClient.release(); }
      await pool.query("INSERT INTO matches (id,season_id,entry_a_id,entry_b_id,stage,format,status) VALUES ($1,$2,$3,$4,'final','bo1','scheduled')", [matchId, seasonId, entryA, entryB]);
      await pool.query("INSERT INTO matches (id,season_id,entry_a_id,entry_b_id,stage,format,status) VALUES ($1,$2,$3,$4,'third_place','bo1','scheduled')", [cancelledMatchId, seasonId, entryA, entryB]);
      await db.transaction((tx) => addMatchCommentatorInTx(tx, { matchId, userId: adminA, actorId: adminA }));
      const prematureSubmission = await pool.query("INSERT INTO post_match_reports (match_id,submitted_by_user_id) VALUES ($1,$2)", [matchId, adminA]).then(() => undefined, (error: { code?: string }) => error); expect(prematureSubmission?.code).toBe("23514");
      await db.transaction((tx) => addMatchCommentatorInTx(tx, { matchId: cancelledMatchId, userId: adminA, actorId: adminA }));
      await db.transaction((tx) => applyMatchStatusTransitionInTx(tx, { matchId: cancelledMatchId, nextStatus: "cancelled", actorId: adminA }));
      const cancelledCommentators = await pool.query<{ count: string }>("SELECT count(*)::text FROM match_commentators WHERE match_id=$1", [cancelledMatchId]); expect(cancelledCommentators.rows[0]?.count).toBe("0");
      const nonAdmin = await pool.query("INSERT INTO match_commentators (match_id,user_id,added_by_user_id) VALUES ($1,$2,$3)", [matchId, outsider, adminA]).then(() => undefined, (error: { code?: string }) => error); expect(nonAdmin?.code).toBe("23514");
      await db.transaction((tx) => addMatchCommentatorInTx(tx, { matchId, userId: adminB, actorId: adminA }));
      await pool.query("UPDATE matches SET status='in_progress' WHERE id=$1", [matchId]);
      const third = await pool.query("INSERT INTO match_commentators (match_id,user_id,added_by_user_id) VALUES ($1,$2,$3)", [matchId, adminC, adminA]).then(() => undefined, (error: { code?: string }) => error); expect(third?.code).toBe("23514");
      await pool.query("UPDATE matches SET status='finished', score_a=1, score_b=0, completed_at=now() WHERE id=$1", [matchId]);
      await expect(db.transaction((tx) => submitPostMatchReportInTx(tx, { matchId, actorId: outsider }))).rejects.toMatchObject({ code: "FORBIDDEN" });
      await db.transaction((tx) => submitPostMatchReportInTx(tx, { matchId, actorId: adminB })); expect(getPostMatchCompletion(new Date(), null)).toBe("waiting_video");
      await pool.query("UPDATE matches SET status='scheduled' WHERE id=$1", [matchId]);
      const prematureSubmissionUpdate = await pool.query("UPDATE post_match_reports SET submitted_at=now() WHERE match_id=$1", [matchId]).then(() => undefined, (error: { code?: string }) => error); expect(prematureSubmissionUpdate?.code).toBe("23514");
      await pool.query("UPDATE matches SET status='finished' WHERE id=$1", [matchId]);
      const frozen = await pool.query("DELETE FROM match_commentators WHERE match_id=$1 AND user_id=$2", [matchId, adminA]).then(() => undefined, (error: { code?: string }) => error); expect(frozen?.code).toBe("23514");
      await db.transaction((tx) => setMatchVideoUrlInTx(tx, { matchId, videoUrl: "https://video.example/match", actorId: adminA })); expect(getPostMatchCompletion(new Date(), "https://video.example/match")).toBe("completed");
      await db.transaction((tx) => revokePostMatchSubmissionInTx(tx, { matchId, actorId: adminA }));
      const columns = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='match_commentators' AND column_name IN ('confirmed_fee_cents','settled_at')"); expect(columns.rows).toHaveLength(0);
      const award = await db.transaction((tx) => submitCommunityAwardInTx(tx, { seasonId, submitterId: outsider, name: "最佳解说", condition: "以实际解说记录为准", prize: "纪念奖品" }));
      await db.transaction((tx) => reviewCommunityAwardInTx(tx, { awardId: award.awardId, status: "approved", reviewNote: null, actorId: adminA }));
      await expect(db.transaction((tx) => addCommunityAwardEvidenceInTx(tx, { awardId: award.awardId, submitterId: outsider, candidateUserId: outsider, matchId, explanation: "不在赛事范围" }))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      await db.transaction((tx) => addCommunityAwardEvidenceInTx(tx, { awardId: award.awardId, submitterId: outsider, candidateUserId: adminA, matchId, explanation: "赛事相关人员的证据", videoUrl: "https://video.example/evidence" }));
      await db.transaction((tx) => resolveCommunityAwardInTx(tx, { awardId: award.awardId, status: "awarded", recipientUserId: adminA, outcomeNote: "确认获奖", actorId: adminB }));
      await db.transaction((tx) => resolveCommunityAwardInTx(tx, { awardId: award.awardId, status: "not_awarded", recipientUserId: null, outcomeNote: "更正结果", actorId: adminB }));
      const supplement = await db.transaction((tx) => submitCommunityAwardInTx(tx, { seasonId, submitterId: outsider, name: "补充奖", condition: "原条件", prize: "原奖品" }));
      await db.transaction((tx) => requestCommunityAwardSupplementInTx(tx, { awardId: supplement.awardId, note: "请补充可判断条件", actorId: adminA }));
      await db.transaction((tx) => reviseCommunityAwardInTx(tx, { awardId: supplement.awardId, submitterId: outsider, name: "补充奖", condition: "修订条件", prize: "修订奖品" }));
      const revised = await pool.query<{ status: string; review_note: string | null }>("SELECT status::text, review_note FROM community_awards WHERE id=$1", [supplement.awardId]); expect(revised.rows[0]).toEqual({ status: "pending_review", review_note: null });
    } finally {
      const cleanupClient = await pool.connect();
      try {
        await cleanupClient.query("BEGIN");
        await cleanupClient.query("SET LOCAL session_replication_role = replica");
        await cleanupClient.query("DELETE FROM community_award_evidence WHERE award_id IN (SELECT id FROM community_awards WHERE season_id = $1)", [seasonId]);
        await cleanupClient.query("DELETE FROM community_awards WHERE season_id = $1", [seasonId]);
        await cleanupClient.query("DELETE FROM post_match_reports WHERE match_id IN ($1, $2)", [matchId, cancelledMatchId]);
        await cleanupClient.query("DELETE FROM match_commentators WHERE match_id IN ($1, $2)", [matchId, cancelledMatchId]);
        await cleanupClient.query("DELETE FROM matches WHERE id IN ($1, $2)", [matchId, cancelledMatchId]);
        await cleanupClient.query("DELETE FROM competition_entry_roster_revisions WHERE entry_id IN ($1, $2)", [entryA, entryB]);
        await cleanupClient.query("DELETE FROM competition_entry_representative_changes WHERE entry_id IN ($1, $2)", [entryA, entryB]);
        await cleanupClient.query("DELETE FROM competition_entries WHERE id IN ($1, $2)", [entryA, entryB]);
        await cleanupClient.query("DELETE FROM season_admin_grants WHERE season_id = $1", [seasonId]);
        await cleanupClient.query("DELETE FROM seasons WHERE id = $1", [seasonId]);
        await cleanupClient.query("DELETE FROM users WHERE id IN ($1, $2, $3, $4, $5)", [adminA, adminB, adminC, outsider, representative]);
        await cleanupClient.query("COMMIT");
      } catch { await cleanupClient.query("ROLLBACK").catch(() => undefined); } finally { cleanupClient.release(); await pool.end(); }
    }
  });
});

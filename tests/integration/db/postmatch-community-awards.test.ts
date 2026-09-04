import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import { localDatabaseUrl } from "./harness/database";

describe("postmatch PostgreSQL invariants", () => {
  it("limits commentators, freezes a submitted roster, and derives completion from video", async () => {
    const databaseUrl = localDatabaseUrl(); process.env.DATABASE_URL = process.env.DATABASE_URL ?? databaseUrl;
    const schema = await import("../../../src/db/schema");
    const { addMatchCommentatorInTx, revokePostMatchSubmissionInTx, submitPostMatchReportInTx, setMatchVideoUrlInTx, getPostMatchCompletion } = await import("../../../src/lib/postmatch/service");
    const { applyMatchStatusTransitionInTx } = await import("../../../src/lib/match-rosters/service");
    const { addCommunityAwardEvidenceInTx, requestCommunityAwardSupplementInTx, resolveCommunityAwardInTx, reviewCommunityAwardInTx, reviseCommunityAwardInTx, submitCommunityAwardInTx, withdrawCommunityAwardInTx } = await import("../../../src/lib/community-awards/service");
    const { isPublicCommunityAward } = await import("../../../src/lib/community-awards/read-model");
    const pool = new Pool({ connectionString: databaseUrl, ssl: false }); const db = drizzle(pool, { schema });
    const seasonId = randomUUID(), adminA = randomUUID(), adminB = randomUUID(), adminC = randomUUID(), outsider = randomUUID(), representative = randomUUID(), entryA = randomUUID(), entryB = randomUUID(), revisionA = randomUUID(), revisionB = randomUUID(), matchId = randomUUID(), cancelledMatchId = randomUUID();
    try {
      const rls = await pool.query<{ table_name: string; rls: boolean; anon_can_select: boolean; authenticated_can_select: boolean }>(
        `SELECT c.relname AS table_name, c.relrowsecurity AS rls,
                has_table_privilege('anon', c.oid, 'select') AS anon_can_select,
                has_table_privilege('authenticated', c.oid, 'select') AS authenticated_can_select
         FROM pg_class c WHERE c.relname IN ('community_awards', 'community_award_evidence', 'match_commentators', 'post_match_reports') ORDER BY c.relname`,
      );
      expect(rls.rows.length === 4 && rls.rows.every((row) => row.rls && !row.anon_can_select && !row.authenticated_can_select), "社区奖与赛后事实必须由 server-only owner 读写。").toBe(true);
      await pool.query("INSERT INTO seasons (id,slug,name,kind,status,registration_mode,has_captain_voting,has_draft) VALUES ($1,$2,'Postmatch','Major','playing','team',false,false)", [seasonId, `postmatch-${randomUUID()}`]);
      const defaultCapability = await pool.query<{ has_community_awards: boolean }>("SELECT has_community_awards FROM seasons WHERE id=$1", [seasonId]);
      expect(defaultCapability.rows[0]?.has_community_awards).toBe(true);
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

      const supplementWithdraw = await db.transaction((tx) => submitCommunityAwardInTx(tx, { seasonId, submitterId: outsider, name: "待补充撤回奖", condition: "原条件", prize: "原奖品" }));
      await db.transaction((tx) => requestCommunityAwardSupplementInTx(tx, { awardId: supplementWithdraw.awardId, note: "请补充可判断条件", actorId: adminA }));
      const supplementRequested = await pool.query<{ status: string; reviewed_at: Date | null; review_note: string | null }>("SELECT status::text, reviewed_at, review_note FROM community_awards WHERE id=$1", [supplementWithdraw.awardId]);
      expect(supplementRequested.rows[0]).toEqual({ status: "pending_review", reviewed_at: null, review_note: "请补充可判断条件" });
      await db.transaction((tx) => withdrawCommunityAwardInTx(tx, { awardId: supplementWithdraw.awardId, submitterId: outsider }));
      const preReviewWithdrawn = await pool.query<{ status: string; reviewed_at: Date | null }>("SELECT status::text, reviewed_at FROM community_awards WHERE id=$1", [supplementWithdraw.awardId]);
      expect(preReviewWithdrawn.rows[0]?.status).toBe("withdrawn");
      expect(isPublicCommunityAward(preReviewWithdrawn.rows[0]!.status, preReviewWithdrawn.rows[0]!.reviewed_at)).toBe(false);

      const publishedWithdraw = await db.transaction((tx) => submitCommunityAwardInTx(tx, { seasonId, submitterId: outsider, name: "公开后撤回奖", condition: "公开条件", prize: "公开奖品" }));
      await db.transaction((tx) => reviewCommunityAwardInTx(tx, { awardId: publishedWithdraw.awardId, status: "approved", reviewNote: null, actorId: adminA }));
      await db.transaction((tx) => withdrawCommunityAwardInTx(tx, { awardId: publishedWithdraw.awardId, submitterId: outsider }));
      const postReviewWithdrawn = await pool.query<{ status: string; reviewed_at: Date | null }>("SELECT status::text, reviewed_at FROM community_awards WHERE id=$1", [publishedWithdraw.awardId]);
      expect(postReviewWithdrawn.rows[0]?.status).toBe("withdrawn");
      expect(isPublicCommunityAward(postReviewWithdrawn.rows[0]!.status, postReviewWithdrawn.rows[0]!.reviewed_at)).toBe(true);

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

  it("fails closed for every community-awards mutation when the season capability is disabled", async () => {
    const databaseUrl = localDatabaseUrl(); process.env.DATABASE_URL = process.env.DATABASE_URL ?? databaseUrl;
    const schema = await import("../../../src/db/schema");
    const { addCommunityAwardEvidenceInTx, requestCommunityAwardSupplementInTx, resolveCommunityAwardInTx, reviewCommunityAwardInTx, reviseCommunityAwardInTx, submitCommunityAwardInTx, withdrawCommunityAwardInTx } = await import("../../../src/lib/community-awards/service");
    const pool = new Pool({ connectionString: databaseUrl, ssl: false }); const db = drizzle(pool, { schema });
    const seasonId = randomUUID();
    const submitterId = randomUUID();
    try {
      await pool.query("INSERT INTO seasons (id,slug,name,kind,status) VALUES ($1,$2,'Disabled awards','custom','playing')", [seasonId, `disabled-community-awards-${seasonId}`]);
      await pool.query("INSERT INTO users (id,email,display_name) VALUES ($1,$2,'Award submitter')", [submitterId, `${submitterId}@local.test`]);
      const award = await db.transaction((tx) => submitCommunityAwardInTx(tx, { seasonId, submitterId, name: "Disabled award", condition: "Condition", prize: "Prize" }));
      await pool.query("UPDATE seasons SET has_community_awards = false WHERE id = $1", [seasonId]);

      const guardedMutations: Array<(tx: TxDb) => Promise<unknown>> = [
        (tx: TxDb) => submitCommunityAwardInTx(tx, { seasonId, submitterId, name: "Blocked submit", condition: "Condition", prize: "Prize" }),
        (tx: TxDb) => reviseCommunityAwardInTx(tx, { awardId: award.awardId, submitterId, name: "Updated", condition: "Condition", prize: "Prize" }),
        (tx: TxDb) => reviewCommunityAwardInTx(tx, { awardId: award.awardId, status: "approved", reviewNote: null, actorId: submitterId }),
        (tx: TxDb) => requestCommunityAwardSupplementInTx(tx, { awardId: award.awardId, note: "Please supplement", actorId: submitterId }),
        (tx: TxDb) => withdrawCommunityAwardInTx(tx, { awardId: award.awardId, submitterId }),
        (tx: TxDb) => addCommunityAwardEvidenceInTx(tx, { awardId: award.awardId, submitterId, explanation: "Blocked evidence" }),
        (tx: TxDb) => resolveCommunityAwardInTx(tx, { awardId: award.awardId, status: "awarded", recipientUserId: submitterId, outcomeNote: "Blocked result", actorId: submitterId }),
      ];

      for (const mutation of guardedMutations) {
        await expect(db.transaction((tx) => mutation(tx))).rejects.toMatchObject({ code: "SEASON_CAPABILITY_DISABLED" });
      }
    } finally {
      await pool.query("DELETE FROM audit_logs WHERE season_id = $1", [seasonId]).catch(() => undefined);
      await pool.query("DELETE FROM community_awards WHERE season_id = $1", [seasonId]).catch(() => undefined);
      await pool.query("DELETE FROM seasons WHERE id = $1", [seasonId]).catch(() => undefined);
      await pool.query("DELETE FROM users WHERE id = $1", [submitterId]).catch(() => undefined);
      await pool.end();
    }
  });
});

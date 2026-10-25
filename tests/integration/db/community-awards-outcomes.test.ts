import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import { localDatabaseUrl } from "./harness/database";

describe("community award outcomes and evidence", () => {
  it("atomically gates, verifies, corrects and serializes complete lists without publishing private evidence", async () => {
    const pool = new Pool({ connectionString: localDatabaseUrl(), ssl: false });
    const schema = await import("@/db/schema");
    const service = await import("@/lib/community-awards/service");
    const { getPublicCommunityAwardBoardData, getAdminCommunityAwardBoardData, getAdminCommunityAwardBoardSummaries } = await import("@/lib/community-awards/data");
    const db = drizzle(pool, { schema });
    const seasonId = randomUUID(), foreignSeasonId = randomUUID();
    const ids = Array.from({ length: 5 }, () => randomUUID());
    const [admin, first, second, third, outsider] = ids as [string, string, string, string, string];
    const version = async (awardId: string) => (await pool.query("SELECT result_version FROM community_awards WHERE id=$1", [awardId])).rows[0].result_version as number;
    const create = async () => {
      const { awardId } = await db.transaction(async tx => service.submitCommunityAwardInTx(tx, { seasonId, submitterId: admin, name: "并列社区奖", condition: "所有并列者", prize: "每人一份" }));
      await db.transaction(async tx => service.reviewCommunityAwardInTx(tx, { awardId, status: "approved", actorId: admin, reviewNote: "内部奖项备注" }));
      return awardId;
    };
    const configure = async (awardId: string, policy: "single" | "limited" | "all_ties", timing: "event_verified" | "play_in_complete" | "stage_complete" | "season_complete", limit: number | null = 1, stage: string | null = null) => db.transaction(async tx => service.configureCommunityAwardInTx(tx, { awardId, actorId: admin, reason: "按已公示规则", recipientPolicy: policy, recipientLimit: limit, settlementPolicy: timing, settlementStageKey: stage, expectedVersion: await version(awardId) }));
    const resolve = async (awardId: string, recipients: string[], status: "awarded" | "not_awarded" | "cancelled" = "awarded", expectedVersion?: number) => db.transaction(async tx => service.resolveCommunityAwardInTx(tx, { awardId, recipientUserIds: recipients, status, outcomeNote: "确认或更正名单", actorId: admin, expectedVersion: expectedVersion ?? await version(awardId) }));
    try {
      await pool.query("INSERT INTO seasons (id,slug,name,kind,status,stage_plan) VALUES ($1,$2,'Awards','custom','registration',$3),($4,$5,'Foreign','custom','registration','[]')", [seasonId, `awards-${seasonId}`, JSON.stringify([{ key: "stage1", name: "正式阶段", type: "swiss", teamCount: 16, matchFormat: "bo1", finalFormat: null, advanceTiers: [] }]), foreignSeasonId, `foreign-${foreignSeasonId}`]);
      for (const id of ids) await pool.query("INSERT INTO users (id,email,display_name) VALUES ($1,$2,$3)", [id, `${id}@local.test`, `公开姓名-${id.slice(0, 6)}`]);
      for (const id of [admin, first, second, third]) await pool.query("INSERT INTO season_admin_grants (season_id,user_id) VALUES ($1,$2)", [seasonId, id]);
      await pool.query("INSERT INTO season_admin_grants (season_id,user_id) VALUES ($1,$2)", [foreignSeasonId, outsider]);
      const awardId = await create();
      await expect(resolve(awardId, [first])).rejects.toMatchObject({ code: "SEASON_INVALID_STATUS" });
      await configure(awardId, "limited", "event_verified", 3);
      await expect(resolve(awardId, [first, second])).rejects.toMatchObject({ code: "SEASON_INVALID_STATUS" });
      const evidenceIds: string[] = [];
      for (const candidate of [first, second, third]) {
        const evidence = await db.transaction(async tx => service.addCommunityAwardEvidenceInTx(tx, { awardId, submitterId: admin, candidateUserId: candidate, explanation: "内部待审候选", videoUrl: "https://video.example/evidence" }));
        evidenceIds.push(evidence.evidenceId);
        await db.transaction(async tx => service.verifyCommunityAwardEvidenceInTx(tx, { awardId, evidenceId: evidence.evidenceId, status: "eligible", note: "内部核验理由", actorId: admin, expectedVersion: await version(awardId) }));
      }
      expect((await pool.query("SELECT status FROM community_awards WHERE id=$1", [awardId])).rows[0].status).toBe("approved");
      await expect(resolve(awardId, [first, first])).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      await expect(resolve(awardId, [first, outsider])).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      await expect(resolve(awardId, [admin, first, second, third])).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      await expect(resolve(awardId, [first], "not_awarded")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      await resolve(awardId, [first, second]);
      const snapshot = (await pool.query("SELECT * FROM community_awards WHERE id=$1", [awardId])).rows[0];
      const auditsBefore = (await pool.query("SELECT id FROM audit_logs WHERE target_id=$1", [awardId])).rows.length;
      await expect(db.transaction(async tx => { await service.resolveCommunityAwardInTx(tx, { awardId, recipientUserIds: [third], status: "awarded", actorId: admin, outcomeNote: "回滚结果", expectedVersion: await version(awardId) }); throw new Error("rollback"); })).rejects.toThrow("rollback");
      expect((await pool.query("SELECT * FROM community_awards WHERE id=$1", [awardId])).rows[0]).toEqual(snapshot);
      expect((await pool.query("SELECT id FROM audit_logs WHERE target_id=$1", [awardId])).rows.length).toBe(auditsBefore);
      const expected = await version(awardId);
      const concurrent = await Promise.allSettled([resolve(awardId, [first, second, third], "awarded", expected), resolve(awardId, [third], "awarded", expected)]);
      expect(concurrent.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(concurrent.filter(result => result.status === "rejected")).toHaveLength(1);
      await resolve(awardId, [first, second, third]);
      const publicBoard = await getPublicCommunityAwardBoardData(db, { seasonId, currentUserId: null, stagePlan: [] });
      const publicAward = publicBoard.awards.find(item => item.id === awardId)!;
      expect(publicAward.recipients.map(item => item.userId)).toEqual([first, second, third]);
      expect(JSON.stringify(publicBoard)).not.toMatch(/内部|verificationNote|verifiedByUserId|evidence/);
      const adminBoard = await getAdminCommunityAwardBoardData(db, { seasonId, stagePlan: [] });
      const adminAward = adminBoard.awards.find(item => item.id === awardId)!;
      const summaryAward = (await getAdminCommunityAwardBoardSummaries(db, { seasonId })).awards.find(item => item.id === awardId)!;
      expect(summaryAward).toMatchObject({ recipients: adminAward.recipients, recipientUserId: first, resultVersion: adminAward.resultVersion, settlementReady: adminAward.settlementReady, nonAwardingReady: adminAward.nonAwardingReady });
      expect(adminBoard.awards.find(item => item.id === awardId)?.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ verificationStatus: "eligible", verifiedByUserId: admin, verifiedAt: expect.any(String), verificationNote: "内部核验理由" })]));
      await db.transaction(async tx => service.verifyCommunityAwardEvidenceInTx(tx, { awardId, evidenceId: evidenceIds[0]!, status: "ineligible", note: "更正核验", actorId: second, expectedVersion: await version(awardId) }));
      await expect(resolve(awardId, [first])).rejects.toMatchObject({ code: "SEASON_INVALID_STATUS" });
      const audit = (await pool.query("SELECT meta FROM audit_logs WHERE target_id=$1 AND action='community_award.evidence.verify' ORDER BY created_at DESC LIMIT 1", [evidenceIds[0]])).rows[0].meta;
      expect(audit).toMatchObject({ previous: { status: "eligible", actorId: admin }, next: { status: "ineligible", actorId: second, note: "更正核验" } });
      await resolve(awardId, [], "cancelled");
      expect((await pool.query("SELECT * FROM community_award_recipients WHERE award_id=$1", [awardId])).rows).toEqual([]);
      await configure(awardId, "all_ties", "season_complete", null);
      await pool.query("UPDATE seasons SET status='finished' WHERE id=$1", [seasonId]);
      await resolve(awardId, [admin, first, second, third]);
      await resolve(awardId, [], "not_awarded");
      expect((await pool.query("SELECT * FROM community_award_recipients WHERE award_id=$1", [awardId])).rows).toEqual([]);
      const outcomeAudit = (await pool.query("SELECT meta FROM audit_logs WHERE target_id=$1 AND action='community_award.not_awarded'", [awardId])).rows[0].meta;
      expect(outcomeAudit).toMatchObject({ previousStatus: "awarded", status: "not_awarded", previousRecipientUserIds: [admin, first, second, third], recipientUserIds: [], outcomeNote: "确认或更正名单" });
      await configure(awardId, "single", "season_complete");
      await resolve(awardId, [first]);
      await expect(resolve(awardId, [first, second])).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      // Play-in completion is independent from Major registration and StageRun identity.
      await pool.query("UPDATE seasons SET status='registration',competition_template='major' WHERE id=$1", [seasonId]);
      const stageAward = await create();
      await configure(stageAward, "single", "play_in_complete");
      await expect(resolve(stageAward, [first])).rejects.toMatchObject({ code: "SEASON_INVALID_STATUS" });
      await pool.query("INSERT INTO competition_qualification_runs (season_id,format,target_entrant_count,candidate_count,direct_entry_count,play_in_entry_count,qualifier_count,configured_by,started_at,started_by) VALUES ($1,'direct_bo3',2,3,1,2,1,'test',now(),'test')", [seasonId]);
      await expect(resolve(stageAward, [first])).rejects.toMatchObject({ code: "SEASON_INVALID_STATUS" });
      await pool.query("UPDATE competition_qualification_runs SET completed_at=now() WHERE season_id=$1", [seasonId]);
      await resolve(stageAward, [first]);
      expect((await pool.query("SELECT status FROM seasons WHERE id=$1", [seasonId])).rows[0].status).toBe("registration");
      const wholeAward = await create();
      await expect(resolve(wholeAward, [first])).rejects.toMatchObject({ code: "SEASON_INVALID_STATUS" });
      await configure(wholeAward, "single", "stage_complete", 1, "stage1");
      await expect(resolve(wholeAward, [first])).rejects.toMatchObject({ code: "SEASON_INVALID_STATUS" });
      const stage = { key: "stage1", name: "正式阶段", type: "swiss", teamCount: 16, matchFormat: "bo1", finalFormat: null, advanceTiers: [] };
      const frozen = { version: 4, rosterRules: { minTeamSize: 5, maxTeamSize: 9, starterCount: 5 }, affiliationRules: [], competitiveProfile: null, frozenCompetitiveFacts: [], runOptions: {}, stagePlan: [stage] };
      await pool.query("INSERT INTO major_stage_runs (season_id,stage_key,rule_snapshot,started_by,finalized_round) VALUES ($1,'stage1',$2,'test',4)", [seasonId, JSON.stringify(frozen)]);
      await expect(resolve(wholeAward, [first])).rejects.toMatchObject({ code: "SEASON_INVALID_STATUS" });
      await pool.query("UPDATE major_stage_runs SET finalized_round=5 WHERE season_id=$1", [seasonId]);
      await resolve(wholeAward, [first]);
      await expect(configure(wholeAward, "single", "season_complete")).rejects.toMatchObject({ code: "SEASON_INVALID_STATUS" });
      const seasonAward = await create();
      await expect(resolve(seasonAward, [first])).rejects.toMatchObject({ code: "SEASON_INVALID_STATUS" });
      const playoff = { ...stage, key: "playoff", name: "淘汰赛", type: "single_elim", teamCount: 8 };
      await pool.query("UPDATE seasons SET stage_plan=$2 WHERE id=$1", [seasonId, JSON.stringify([stage, playoff])]);
      const playoffRun = randomUUID(), entryId = randomUUID(), revisionId = randomUUID();
      await pool.query("INSERT INTO major_stage_runs (id,season_id,stage_key,rule_snapshot,started_by) VALUES ($1,$2,'playoff',$3,'test')", [playoffRun, seasonId, JSON.stringify({ ...frozen, stagePlan: [stage, playoff] })]);
      const playoffAward = await create();
      await configure(playoffAward, "single", "stage_complete", 1, "playoff");
      await expect(resolve(playoffAward, [first])).rejects.toMatchObject({ code: "SEASON_INVALID_STATUS" });
      await db.transaction(async tx => {
        await tx.execute((await import("drizzle-orm")).sql`INSERT INTO competition_entries (id,competition_id,source,name,representative_user_id,current_roster_revision_id,approved_roster_revision_id,registration_status) VALUES (${entryId},${seasonId},'event_native','Champion',${admin},${revisionId},${revisionId},'approved')`);
        await tx.execute((await import("drizzle-orm")).sql`INSERT INTO competition_entry_representative_changes (entry_id,from_user_id,to_user_id,changed_by_actor_id) VALUES (${entryId},NULL,${admin},'test')`);
        await tx.execute((await import("drizzle-orm")).sql`INSERT INTO competition_entry_roster_revisions (id,entry_id,revision_number,status,created_by,approved_at) VALUES (${revisionId},${entryId},1,'approved','test',now())`);
      });
      await pool.query("INSERT INTO major_tournament_entrants (season_id,competition_entry_id) VALUES ($1,$2)", [seasonId, entryId]);
      await pool.query("INSERT INTO major_final_results (season_id,playoff_stage_run_id,champion_entry_id,placement_groups,finalized_by) VALUES ($1,$2,$3,$4,'test')", [seasonId, playoffRun, entryId, JSON.stringify([{ from: 1, to: 1, entryIds: [entryId] }])]);
      await resolve(playoffAward, [first]);
      await expect(resolve(seasonAward, [first])).rejects.toMatchObject({ code: "SEASON_INVALID_STATUS" });
      await pool.query("UPDATE major_final_results SET status='confirmed',confirmed_at=now(),confirmed_by='test' WHERE season_id=$1", [seasonId]);
      await resolve(seasonAward, [first]);
      // Identity convergence must preserve full lists and the legacy projection without re-awarding.
      await configure(wholeAward, "limited", "season_complete", 3);
      await resolve(wholeAward, [first, second, third]);
      await db.transaction(tx => service.reparentCommunityAwardRecipientsInTx(tx, { canonicalUserId: second, mergedUserId: first, actorId: admin }));
      expect((await pool.query("SELECT user_id FROM community_award_recipients WHERE award_id=$1 ORDER BY position", [wholeAward])).rows.map(row => row.user_id)).toEqual([second, third]);
      expect((await pool.query("SELECT recipient_user_id FROM community_awards WHERE id=$1", [wholeAward])).rows[0].recipient_user_id).toBe(second);

    } finally {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL session_replication_role=replica");
        for (const table of ["community_award_recipients", "community_award_evidence"]) await client.query(`DELETE FROM ${table} WHERE award_id IN (SELECT id FROM community_awards WHERE season_id=$1)`, [seasonId]);
        for (const table of ["community_awards", "audit_logs", "major_final_results", "major_stage_runs", "major_tournament_entrants", "competition_qualification_runs", "season_admin_grants"]) await client.query(`DELETE FROM ${table} WHERE season_id IN ($1,$2)`, [seasonId, foreignSeasonId]);
        await client.query("DELETE FROM competition_entry_roster_revisions WHERE entry_id IN (SELECT id FROM competition_entries WHERE competition_id=$1)", [seasonId]);
        await client.query("DELETE FROM competition_entry_representative_changes WHERE entry_id IN (SELECT id FROM competition_entries WHERE competition_id=$1)", [seasonId]);
        await client.query("DELETE FROM competition_entries WHERE competition_id=$1", [seasonId]);
        await client.query("DELETE FROM seasons WHERE id IN ($1,$2)", [seasonId, foreignSeasonId]);
        await client.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
        await client.query("COMMIT");
      } finally { client.release(); await pool.end(); }
    }
  });
});

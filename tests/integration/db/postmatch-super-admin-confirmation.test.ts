import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, it } from "vitest";
import { localDatabaseUrl } from "./harness/database";

it("confirms reopened nonempty rosters as the real super-admin while preserving ordinary authorization and atomicity", async () => {
  const databaseUrl = localDatabaseUrl(); process.env.DATABASE_URL ??= databaseUrl;
  const schema = await import("../../../src/db/schema");
  const { addMatchCommentatorInTx: add, removeMatchCommentatorInTx: remove, revokePostMatchSubmissionInTx: reopen,
    submitPostMatchReportInTx: confirm } = await import("../../../src/lib/postmatch/service");
  const { readReopenedPostMatchIds } = await import("../../../src/lib/postmatch/read");
  const pool = new Pool({ connectionString: databaseUrl, ssl: false });
  const db = drizzle(pool, { schema });
  const seasonId = randomUUID(), matchId = randomUUID(), superAdmin = randomUUID(), casterA = randomUUID(), casterB = randomUUID(), ordinaryAdmin = randomUUID();
  const entryA = randomUUID(), entryB = randomUUID();
  try {
    await pool.query("INSERT INTO seasons (id,slug,name,kind,status) VALUES ($1,$2,'Correction','custom','playing')", [seasonId, `correction-${seasonId}`]);
    for (const id of [superAdmin, casterA, casterB, ordinaryAdmin]) {
      await pool.query("INSERT INTO users (id,email,role) VALUES ($1,$2,$3)", [id, `${id}@local.test`, id === superAdmin ? "super_admin" : "user"]);
    }
    for (const id of [casterA, casterB, ordinaryAdmin]) await pool.query("INSERT INTO season_admin_grants (season_id,user_id) VALUES ($1,$2)", [seasonId, id]);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const id of [entryA, entryB]) {
        const revision = randomUUID();
        await client.query("INSERT INTO competition_entries (id,competition_id,source,name,representative_user_id,current_roster_revision_id,approved_roster_revision_id,registration_status) VALUES ($1,$2,'event_native',$3,$4,$5,$5,'approved')", [id, seasonId, id, casterA, revision]);
        await client.query("INSERT INTO competition_entry_representative_changes (entry_id,from_user_id,to_user_id,changed_by_actor_id) VALUES ($1,NULL,$2,'local-test')", [id, casterA]);
        await client.query("INSERT INTO competition_entry_roster_revisions (id,entry_id,revision_number,status,created_by,approved_at) VALUES ($1,$2,1,'approved','local-test',now())", [revision, id]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    await pool.query("INSERT INTO matches (id,season_id,entry_a_id,entry_b_id,stage,format,status,score_a,score_b,video_url) VALUES ($1,$2,$3,$4,'final','bo1','scheduled',1,0,'https://video.example/preserve')", [matchId, seasonId, entryA, entryB]);
    const submit = (actorId: string) => db.transaction(tx => confirm(tx, { matchId, actorId }));
    const rawSubmit = (actorId: string) => pool.query("INSERT INTO post_match_reports (match_id,submitted_by_user_id) VALUES ($1,$2)", [matchId, actorId]);
    const expectTriggerDenial = async (work: Promise<unknown>) => expect(await work.then(() => null, (error: { code: string }) => error.code)).toBe("23514");
    for (const status of ["scheduled", "in_progress", "cancelled"]) {
      await pool.query("UPDATE matches SET status=$2 WHERE id=$1", [matchId, status]);
      await expect(submit(superAdmin)).rejects.toMatchObject({ code: "MATCH_INVALID_TRANSITION" });
      await expectTriggerDenial(rawSubmit(superAdmin));
    }
    await pool.query("UPDATE matches SET status='scheduled' WHERE id=$1", [matchId]);
    for (const userId of [casterA, casterB]) await db.transaction(tx => add(tx, { matchId, userId, actorId: superAdmin }));
    await pool.query("UPDATE matches SET status='finished' WHERE id=$1", [matchId]);
    // The exception cannot bypass an explicit reopen, even when two casters exist.
    await expect(submit(superAdmin)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expectTriggerDenial(rawSubmit(superAdmin));
    await db.transaction(tx => reopen(tx, { matchId, actorId: superAdmin }));
    await db.transaction(tx => remove(tx, { matchId, userId: casterB, actorId: superAdmin }));
    await expect(submit(ordinaryAdmin)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expectTriggerDenial(rawSubmit(ordinaryAdmin));
    await expect(db.transaction(async tx => {
      await confirm(tx, { matchId, actorId: superAdmin });
      throw new Error("rollback confirmation");
    })).rejects.toThrow("rollback confirmation");
    expect((await pool.query("SELECT * FROM post_match_reports WHERE match_id=$1", [matchId])).rows).toEqual([]);
    expect((await pool.query("SELECT * FROM audit_logs WHERE target_id=$1 AND action='postmatch.report.submit'", [matchId])).rows).toEqual([]);
    expect((await readReopenedPostMatchIds(db, [matchId])).has(matchId)).toBe(true);
    // Two concurrent confirmations serialize: one confirmation and exactly one real-actor audit.
    const attempts = await Promise.allSettled([submit(superAdmin), submit(superAdmin)]);
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "SEASON_INVALID_STATUS" } });
    expect((await pool.query("SELECT submitted_by_user_id FROM post_match_reports WHERE match_id=$1", [matchId])).rows).toEqual([{ submitted_by_user_id: superAdmin }]);
    expect((await pool.query("SELECT actor_id,meta->>'submittedByUserId' AS submitter FROM audit_logs WHERE target_id=$1 AND action='postmatch.report.submit'", [matchId])).rows).toEqual([{ actor_id: superAdmin, submitter: superAdmin }]);
    expect((await pool.query("SELECT user_id FROM match_commentators WHERE match_id=$1", [matchId])).rows).toEqual([{ user_id: casterA }]);
    expect((await readReopenedPostMatchIds(db, [matchId])).has(matchId)).toBe(false);
    await expectTriggerDenial(pool.query("DELETE FROM match_commentators WHERE match_id=$1", [matchId]));
    await expectTriggerDenial(pool.query("UPDATE post_match_reports SET submitted_at=now() WHERE match_id=$1", [matchId]));
    // Reopening also permits a super-admin to remove themselves, then confirm as themselves.
    await db.transaction(tx => reopen(tx, { matchId, actorId: superAdmin }));
    await db.transaction(tx => add(tx, { matchId, userId: superAdmin, actorId: superAdmin }));
    await db.transaction(tx => remove(tx, { matchId, userId: superAdmin, actorId: superAdmin }));
    await submit(superAdmin);
    await db.transaction(tx => reopen(tx, { matchId, actorId: superAdmin }));
    await db.transaction(tx => remove(tx, { matchId, userId: casterA, actorId: superAdmin }));
    await expect(submit(superAdmin)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expectTriggerDenial(rawSubmit(superAdmin));
    await db.transaction(tx => add(tx, { matchId, userId: casterA, actorId: superAdmin }));
    // A revoked platform role must not survive as a forwarded authorization fact.
    await pool.query("UPDATE users SET role='user' WHERE id=$1", [superAdmin]);
    await expect(submit(superAdmin)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expectTriggerDenial(rawSubmit(superAdmin));
    // Ordinary in-roster single-caster confirmation is preserved.
    await submit(casterA);
    await pool.query("UPDATE users SET role='super_admin' WHERE id=$1", [superAdmin]);
    await expectTriggerDenial(pool.query("UPDATE post_match_reports SET submitted_by_user_id=$2 WHERE match_id=$1", [matchId, superAdmin]));
    expect((await pool.query("SELECT score_a,score_b,video_url,recordings FROM matches WHERE id=$1", [matchId])).rows).toEqual([{ score_a: 1, score_b: 0, video_url: "https://video.example/preserve", recordings: [] }]);
  } finally {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("DELETE FROM audit_logs WHERE season_id=$1", [seasonId]);
      await client.query("DELETE FROM post_match_reports WHERE match_id=$1", [matchId]);
      await client.query("DELETE FROM match_commentators WHERE match_id=$1", [matchId]);
      await client.query("DELETE FROM matches WHERE id=$1", [matchId]);
      await client.query("DELETE FROM competition_entry_roster_revisions WHERE entry_id IN ($1,$2)", [entryA, entryB]);
      await client.query("DELETE FROM competition_entry_representative_changes WHERE entry_id IN ($1,$2)", [entryA, entryB]);
      await client.query("DELETE FROM competition_entries WHERE competition_id=$1", [seasonId]);
      await client.query("DELETE FROM season_admin_grants WHERE season_id=$1", [seasonId]);
      await client.query("DELETE FROM seasons WHERE id=$1", [seasonId]);
      await client.query("DELETE FROM users WHERE id IN ($1,$2,$3,$4)", [superAdmin, casterA, casterB, ordinaryAdmin]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); await pool.end(); }
  }
});

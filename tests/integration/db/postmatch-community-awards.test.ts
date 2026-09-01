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
    const pool = new Pool({ connectionString: databaseUrl, ssl: false }); const db = drizzle(pool, { schema });
    const seasonId = randomUUID(), adminA = randomUUID(), adminB = randomUUID(), outsider = randomUUID(), representative = randomUUID(), entryA = randomUUID(), entryB = randomUUID(), matchId = randomUUID();
    try {
      await pool.query("INSERT INTO seasons (id,slug,name,kind,status,registration_mode,has_captain_voting,has_draft) VALUES ($1,$2,'Postmatch','Major','playing','team',false,false)", [seasonId, `postmatch-${randomUUID()}`]);
      for (const [id, name] of [[adminA, "解说甲"], [adminB, "解说乙"], [outsider, "非管理员"], [representative, "代表"]]) await pool.query("INSERT INTO users (id,email,display_name) VALUES ($1,$2,$3)", [id, `${id}@local.test`, name]);
      await pool.query("INSERT INTO season_admin_grants (user_id,season_id) VALUES ($1,$3),($2,$3)", [adminA, adminB, seasonId]);
      for (const [id, name] of [[entryA, "A 队"], [entryB, "B 队"]]) await pool.query("INSERT INTO competition_entries (id,competition_id,source,name,representative_user_id,registration_status) VALUES ($1,$2,'event_native',$3,$4,'approved')", [id, seasonId, name, representative]);
      await pool.query("INSERT INTO matches (id,season_id,entry_a_id,entry_b_id,stage,format,status,score_a,score_b,completed_at) VALUES ($1,$2,$3,$4,'final','bo1','finished',1,0,now())", [matchId, seasonId, entryA, entryB]);
      await db.transaction((tx) => addMatchCommentatorInTx(tx, { matchId, userId: adminA, actorId: adminA })); await db.transaction((tx) => addMatchCommentatorInTx(tx, { matchId, userId: adminB, actorId: adminA }));
      const third = await pool.query("INSERT INTO match_commentators (match_id,user_id,added_by_user_id) VALUES ($1,$2,$3)", [matchId, outsider, adminA]).then(() => undefined, (error: { code?: string }) => error); expect(third?.code).toBe("23514");
      await expect(db.transaction((tx) => submitPostMatchReportInTx(tx, { matchId, actorId: outsider }))).rejects.toMatchObject({ code: "FORBIDDEN" });
      await db.transaction((tx) => submitPostMatchReportInTx(tx, { matchId, actorId: adminB })); expect(getPostMatchCompletion(new Date(), null)).toBe("waiting_video");
      const frozen = await pool.query("DELETE FROM match_commentators WHERE match_id=$1 AND user_id=$2", [matchId, adminA]).then(() => undefined, (error: { code?: string }) => error); expect(frozen?.code).toBe("23514");
      await db.transaction((tx) => setMatchVideoUrlInTx(tx, { matchId, videoUrl: "https://video.example/match", actorId: adminA })); expect(getPostMatchCompletion(new Date(), "https://video.example/match")).toBe("completed");
      await db.transaction((tx) => revokePostMatchSubmissionInTx(tx, { matchId, actorId: adminA }));
      const columns = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='match_commentators' AND column_name IN ('confirmed_fee_cents','settled_at')"); expect(columns.rows).toHaveLength(0);
    } finally { await pool.query("DELETE FROM seasons WHERE id=$1", [seasonId]).catch(() => undefined); await pool.end(); }
  });
});

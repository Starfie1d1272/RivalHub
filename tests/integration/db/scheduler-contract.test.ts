import { describe, expect, it } from "vitest";
import { withScratchDatabase } from "./harness/migration-replay";
import { createLocalPool } from "./harness/database";

describe("installed scheduler boundary", () => {
  it("keeps repair dispatch available and denies public role execution", async () => {
    const pool = createLocalPool({ max: 1 });
    try {
      expect((await pool.query("SELECT public.scheduler_job_is_due('rebuild-statistics-projections') AS due")).rows).toEqual([{ due: true }]);
      await expect(pool.query("SELECT public.scheduler_job_is_due('unknown-test-job')")).rejects.toMatchObject({ code: "22023" });
      for (const role of ["anon", "authenticated"]) {
        for (const name of ["scheduler_job_is_due", "dispatch_rivalhub_scheduler_job", "enqueue_rivalhub_scheduler_job"]) {
          expect((await pool.query("SELECT has_function_privilege($1, $2, 'EXECUTE') AS allowed", [role, `public.${name}(text)`])).rows).toEqual([{ allowed: false }]);
        }
        expect((await pool.query("SELECT has_table_privilege($1, 'public.scheduled_job_health', 'SELECT') AS allowed", [role])).rows).toEqual([{ allowed: false }]);
      }
    } finally { await pool.end(); }
  });
  it("only settles finished, overdue MVP matches with canonical votes", async () => {
    const pool = createLocalPool({ max: 1 });
    try {
      const definition = (await pool.query("SELECT pg_get_functiondef('public.scheduler_job_is_due(text)'::regprocedure) AS sql")).rows[0].sql;
      await withScratchDatabase("scheduler_due", async client => {
        await client.query("CREATE TABLE matches (id int, status text, completed_at timestamptz, mvp_winner_user_id int); CREATE TABLE match_mvp_votes (match_id int, player_user_id int)");
        await client.query(definition);
        const due = async () => (await client.query("SELECT public.scheduler_job_is_due('settle-match-mvp') AS due")).rows[0].due;
        await client.query("INSERT INTO matches VALUES (1, 'in_progress', now() - interval '25 hours', NULL); INSERT INTO match_mvp_votes VALUES (1, 1)");
        expect(await due()).toBe(false);
        await client.query("UPDATE matches SET status = 'finished', completed_at = now()");
        expect(await due()).toBe(false);
        await client.query("UPDATE matches SET completed_at = now() - interval '25 hours'; UPDATE match_mvp_votes SET player_user_id = NULL");
        expect(await due()).toBe(false);
        await client.query("UPDATE match_mvp_votes SET player_user_id = 1");
        expect(await due()).toBe(true);
        await client.query("UPDATE matches SET mvp_winner_user_id = 1");
        expect(await due()).toBe(false);
      });
    } finally { await pool.end(); }
  });

});

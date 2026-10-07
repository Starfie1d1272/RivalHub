import { describe, expect, it } from "vitest";
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
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "drizzle/migrations/0045_fresh_blue_blade.sql"),
  "utf8",
);
const reliabilityMigration = readFileSync(
  join(process.cwd(), "drizzle/migrations/0047_scheduler_dispatch_reliability.sql"),
  "utf8",
);
const vetoSchedulerMigration = readFileSync(
  join(process.cwd(), "drizzle/migrations/0059_veto_scheduler_dispatch.sql"),
  "utf8",
);

describe("scheduler migration contract", () => {
  it("keeps repair dispatch independent of the application calculation version", () => {
    const projectionMigration = readFileSync(join(process.cwd(), "drizzle/migrations/0067_chief_midnight.sql"), "utf8");
    expect(projectionMigration.match(/'rebuild-statistics-projections'/g)).toHaveLength(3);
    const dispatchCase = projectionMigration.split("WHEN 'rebuild-statistics-projections' THEN")[1]?.split("WHEN 'settle-match-mvp' THEN")[0];
    expect(dispatchCase).toContain("RETURN true;");
    expect(dispatchCase).not.toContain("projection_version =");
  });

  it("only dispatches MVP settlement for due matches with eligible votes", () => {
    const mvpMigration = readFileSync(join(process.cwd(), "drizzle/migrations/0067_chief_midnight.sql"), "utf8");
    expect(mvpMigration.match(/'settle-match-mvp'/g)).toHaveLength(3);
    expect(mvpMigration).toContain("mvp_match.status = 'finished'");
    expect(mvpMigration).toContain("mvp_match.completed_at <= clock_timestamp() - interval '24 hours'");
    expect(mvpMigration).toContain("mvp_match.mvp_winner_user_id IS NULL");
    expect(mvpMigration).toContain("vote.match_id = mvp_match.id AND vote.player_user_id IS NOT NULL");
    expect(mvpMigration).toContain('REVOKE ALL PRIVILEGES ON FUNCTION "public"."scheduler_job_is_due"(text) FROM PUBLIC, anon, authenticated;');
  });

  it("keeps health and dispatch server-only", () => {
    expect(migration).toContain('ALTER TABLE "scheduled_job_health" ENABLE ROW LEVEL SECURITY;');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE "scheduled_job_health" FROM anon, authenticated;');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION "public"."dispatch_rivalhub_scheduler_job"(job_key text)');
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON FUNCTION "public"."dispatch_rivalhub_scheduler_job"(text) FROM PUBLIC, anon, authenticated;');
  });

  it("delegates to Vault and pg_net without embedding the credential", () => {
    expect(migration).toContain("rivalhub_scheduler_base_url");
    expect(migration).toContain("rivalhub_cron_secret");
    expect(migration).toContain("net.http_get");
    expect(migration).toContain("X-RivalHub-Cron-Source");
    expect(migration).toContain("base_url || '/api/cron/' || job_key");
    expect(migration).not.toContain("route_segment := CASE");
    expect(migration).not.toContain("INSERT INTO \"scheduled_job_health\" (\"job_key\") VALUES");
    expect(migration).not.toContain("CRON_SECRET :=");
  });

  it("replaces the dispatch body without changing the published function identity", () => {
    expect(reliabilityMigration).toContain('CREATE OR REPLACE FUNCTION "public"."dispatch_rivalhub_scheduler_job"(job_key text)');
    expect(reliabilityMigration).toContain("p_job_key text := $1");
    expect(reliabilityMigration).toContain("VALUES (p_job_key, clock_timestamp(), clock_timestamp())");
    expect(reliabilityMigration).toContain("ON CONFLICT ON CONSTRAINT scheduled_job_health_pkey");
    expect(reliabilityMigration).not.toContain("ON CONFLICT (job_key)");
  });

  it("allows and due-gates the Veto Room scheduler job in production dispatch", () => {
    expect(vetoSchedulerMigration).toContain("WHEN 'resolve-match-veto-timeouts' THEN");
    expect(vetoSchedulerMigration.match(/'resolve-match-veto-timeouts'/g)).toHaveLength(3);
    expect(vetoSchedulerMigration).toContain("public.match_veto_sessions AS veto_session");
    expect(vetoSchedulerMigration).toContain(
      'CREATE OR REPLACE FUNCTION "public"."enqueue_rivalhub_scheduler_job"(job_key text)',
    );
    expect(vetoSchedulerMigration).toContain(
      'CREATE OR REPLACE FUNCTION "public"."dispatch_rivalhub_scheduler_job"(job_key text)',
    );
    expect(vetoSchedulerMigration).toContain(
      'REVOKE ALL PRIVILEGES ON FUNCTION "public"."dispatch_rivalhub_scheduler_job"(text) FROM PUBLIC, anon, authenticated;',
    );
  });
});

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

describe("scheduler migration contract", () => {
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
});

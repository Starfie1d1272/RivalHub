import { Pool } from "pg";
import { SCHEDULER_JOB_DEFINITIONS } from "../../src/lib/scheduler/definitions";
import { isPrimaryHealthHealthy } from "../../src/lib/scheduler/health-contract";

type HealthRow = {
  job_key: string;
  last_primary_triggered_at: Date | null;
  last_primary_dispatch_requested_at: Date | null;
  last_primary_endpoint_succeeded_at: Date | null;
};

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for scheduler watchdog planning.");

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });

  try {
    const result = await pool.query<HealthRow>(`
      SELECT
        job_key,
        last_primary_triggered_at,
        last_primary_dispatch_requested_at,
        last_primary_endpoint_succeeded_at
      FROM public.scheduled_job_health
      WHERE job_key = ANY($1::text[])
    `, [SCHEDULER_JOB_DEFINITIONS.map((definition) => definition.key)]);

    const byKey = new Map(result.rows.map((row) => [row.job_key, row]));
    const now = new Date();
    const stale = SCHEDULER_JOB_DEFINITIONS
      .filter((definition) => {
        const row = byKey.get(definition.key);
        return !isPrimaryHealthHealthy(row ? {
          lastPrimaryTriggeredAt: row.last_primary_triggered_at,
          lastPrimaryDispatchRequestedAt: row.last_primary_dispatch_requested_at,
          lastPrimaryEndpointSucceededAt: row.last_primary_endpoint_succeeded_at,
        } : null, definition, now);
      })
      .map((definition) => definition.key);

    process.stdout.write(JSON.stringify(stale));
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

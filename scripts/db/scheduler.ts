import { Pool } from "pg";
import { pathToFileURL } from "node:url";
import { buildProductionEnvironment } from "./production-environment";
import {
  SCHEDULER_JOB_DEFINITIONS,
  schedulerJobName,
  type SchedulerJobDefinition,
} from "../../src/lib/scheduler/definitions";

const BASE_URL_ENV = "RIVALHUB_SCHEDULER_BASE_URL";
const VAULT_SECRET_NAMES = ["rivalhub_scheduler_base_url", "rivalhub_cron_secret"] as const;
const DISPATCH_VERIFY_TIMEOUT_MS = 90_000;
const DISPATCH_VERIFY_POLL_MS = 2_000;

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "provision" && command !== "verify") {
    throw new Error("用法：tsx scripts/db/scheduler.ts <provision|verify>");
  }

  const environment = buildProductionEnvironment(process.env, {
    requiresWriteAuthorization: command === "provision",
  });
  const databaseUrl = required(environment.DATABASE_URL, "DATABASE_URL");
  const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false }, max: 1 });

  try {
    await assertProviderContract(pool);
    if (command === "provision") {
      const baseUrl = validateBaseUrl(required(environment[BASE_URL_ENV], BASE_URL_ENV));
      const cronSecret = required(environment.CRON_SECRET, "CRON_SECRET");
      await upsertVaultSecret(pool, "rivalhub_scheduler_base_url", baseUrl, "RivalHub scheduler public base URL");
      await upsertVaultSecret(pool, "rivalhub_cron_secret", cronSecret, "RivalHub scheduler shared credential");
      await upsertCronJobs(pool);
      console.log(`Production scheduler provisioned: ${SCHEDULER_JOB_DEFINITIONS.length} named jobs.`);
    }
    await verifyCronJobs(pool);
    await verifyVaultNames(pool);
    if (command === "verify") {
      await verifyPrimaryDispatch(pool);
      console.log("Production scheduler verification passed: named jobs, Vault names, primary dispatch, endpoint success, and minute cadence are healthy.");
    } else {
      console.log("Production scheduler provisioning contract passed: named jobs, UTC schedules, dispatch command, and Vault names are present.");
    }
  } finally {
    await pool.end();
  }
}

async function assertProviderContract(pool: Pool): Promise<void> {
  const result = await pool.query<{ cron_extension: string | null; net_extension: string | null; cron_schema: string | null; net_schema: string | null; cron_timezone: string | null }>(`
    SELECT
      (SELECT extname FROM pg_extension WHERE extname = 'pg_cron') AS cron_extension,
      (SELECT extname FROM pg_extension WHERE extname = 'pg_net') AS net_extension,
      to_regnamespace('cron')::text AS cron_schema,
      to_regnamespace('net')::text AS net_schema,
      current_setting('cron.timezone', true) AS cron_timezone
  `);
  const facts = result.rows[0];
  const cronTimezone = facts?.cron_timezone?.trim().toUpperCase();
  if (facts?.cron_extension !== "pg_cron" || facts?.net_extension !== "pg_net" || !facts?.cron_schema || !facts?.net_schema) {
    throw new Error("Production scheduler extensions pg_cron/pg_net 未完整启用；拒绝配置 named jobs。");
  }
  if (!cronTimezone || !["UTC", "GMT", "ETC/UTC"].includes(cronTimezone)) {
    throw new Error("Production scheduler cron.timezone 必须保持 UTC；拒绝配置 named jobs。");
  }
}

async function upsertVaultSecret(pool: Pool, name: string, value: string, description: string): Promise<void> {
  const existing = await pool.query<{ id: string }>(
    "SELECT id::text FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1",
    [name],
  );
  if (existing.rows[0]?.id) {
    await pool.query("SELECT vault.update_secret($1::uuid, $2, $3, $4)", [existing.rows[0].id, value, name, description]);
  } else {
    await pool.query("SELECT vault.create_secret($1, $2, $3)", [value, name, description]);
  }
}

export async function upsertCronJobs(pool: Pick<Pool, "query">): Promise<void> {
  for (const definition of SCHEDULER_JOB_DEFINITIONS) {
    const name = schedulerJobName(definition.key);
    await pool.query("SELECT cron.schedule($1::text, $2::text, $3::text)", [name, definition.primaryCron, dispatchCommand(definition)]);
  }
}

async function verifyCronJobs(pool: Pool): Promise<void> {
  const names = SCHEDULER_JOB_DEFINITIONS.map((definition) => schedulerJobName(definition.key));
  const result = await pool.query<{ jobname: string; schedule: string; command: string; active: boolean }>(
    "SELECT jobname, schedule, command, active FROM cron.job WHERE jobname = ANY($1::text[])",
    [names],
  );
  if (result.rows.length !== SCHEDULER_JOB_DEFINITIONS.length) {
    throw new Error("Production scheduler named jobs 数量不完整。");
  }
  const rows = new Map(result.rows.map((row) => [row.jobname, row]));
  for (const definition of SCHEDULER_JOB_DEFINITIONS) {
    const row = rows.get(schedulerJobName(definition.key));
    if (!row || !row.active || row.schedule !== definition.primaryCron || row.command !== dispatchCommand(definition)) {
      throw new Error(`Production scheduler job ${schedulerJobName(definition.key)} contract 不匹配。`);
    }
  }
}

async function verifyVaultNames(pool: Pool): Promise<void> {
  const result = await pool.query<{ name: string }>(
    "SELECT name FROM vault.decrypted_secrets WHERE name = ANY($1::text[])",
    [VAULT_SECRET_NAMES],
  );
  const names = new Set(result.rows.map((row) => row.name));
  if (VAULT_SECRET_NAMES.some((name) => !names.has(name))) {
    throw new Error("Production scheduler Vault names 不完整。");
  }
}

type SchedulerHealthEvidence = {
  job_key: string;
  last_primary_triggered_at: Date | null;
  last_primary_endpoint_succeeded_at: Date | null;
};

type SchedulerRunEvidence = { jobname: string; status: string };

export function hasCompletePrimaryEvidence(
  verifiedAt: Date,
  healthRows: readonly SchedulerHealthEvidence[],
  runRows: readonly SchedulerRunEvidence[],
): boolean {
  const healthByKey = new Map(healthRows.map((row) => [row.job_key, row]));
  const healthReady = SCHEDULER_JOB_DEFINITIONS.every((definition) => {
    const row = healthByKey.get(definition.key);
    return !!row?.last_primary_triggered_at
      && row.last_primary_triggered_at >= verifiedAt
      && !!row.last_primary_endpoint_succeeded_at
      && row.last_primary_endpoint_succeeded_at >= verifiedAt;
  });
  const minuteJobNames = new Set(SCHEDULER_JOB_DEFINITIONS
    .filter((definition) => definition.primaryCron === "* * * * *")
    .map((definition) => schedulerJobName(definition.key)));
  const succeededMinuteJobs = new Set(runRows
    .filter((row) => row.status === "succeeded" && minuteJobNames.has(row.jobname))
    .map((row) => row.jobname));
  return healthReady && [...minuteJobNames].every((name) => succeededMinuteJobs.has(name));
}

async function verifyPrimaryDispatch(pool: Pool): Promise<void> {
  const [{ verified_at: verifiedAt }] = (await pool.query<{ verified_at: Date }>(
    "SELECT clock_timestamp() AS verified_at",
  )).rows;
  if (!verifiedAt) throw new Error("Production scheduler 无法建立 dispatch 验证时间边界。");

  for (const definition of SCHEDULER_JOB_DEFINITIONS) {
    await pool.query("SELECT public.dispatch_rivalhub_scheduler_job($1::text)", [definition.key]);
  }

  const names = SCHEDULER_JOB_DEFINITIONS.map((definition) => schedulerJobName(definition.key));
  const deadline = Date.now() + DISPATCH_VERIFY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const [healthResult, runResult] = await Promise.all([
      pool.query<SchedulerHealthEvidence>(`
        SELECT job_key, last_primary_triggered_at, last_primary_endpoint_succeeded_at
        FROM public.scheduled_job_health
        WHERE job_key = ANY($1::text[])
      `, [SCHEDULER_JOB_DEFINITIONS.map((definition) => definition.key)]),
      pool.query<SchedulerRunEvidence>(`
        SELECT job.jobname, details.status
        FROM cron.job_run_details AS details
        INNER JOIN cron.job AS job ON job.jobid = details.jobid
        WHERE job.jobname = ANY($1::text[])
          AND details.start_time >= $2
      `, [names, verifiedAt]),
    ]);
    const failedRun = runResult.rows.find((row) => row.status === "failed");
    if (failedRun) {
      throw new Error(`Production scheduler job ${failedRun.jobname} 在验证窗口内执行失败。`);
    }
    if (hasCompletePrimaryEvidence(verifiedAt, healthResult.rows, runResult.rows)) return;
    await new Promise((resolve) => setTimeout(resolve, DISPATCH_VERIFY_POLL_MS));
  }

  throw new Error("Production scheduler 未在有界窗口内形成 fresh primary trigger、endpoint success 与分钟级 cron 成功证据。");
}

export function dispatchCommand(definition: SchedulerJobDefinition): string {
  return `SELECT public.dispatch_rivalhub_scheduler_job('${definition.key}');`;
}

export function validateBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${BASE_URL_ENV} 必须是有效的 HTTPS origin。`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error(`${BASE_URL_ENV} 必须是无凭据、无路径的 HTTPS origin。`);
  }
  return url.origin;
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} 未设置；拒绝继续。`);
  return value.trim();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

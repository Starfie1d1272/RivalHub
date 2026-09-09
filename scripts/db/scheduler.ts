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
      await replaceCronJobs(pool);
      console.log(`Production scheduler provisioned: ${SCHEDULER_JOB_DEFINITIONS.length} named jobs.`);
    }
    await verifyCronJobs(pool);
    await verifyVaultNames(pool);
    console.log("Production scheduler verification passed: named jobs, UTC schedules, dispatch command, and Vault names are present.");
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

async function replaceCronJobs(pool: Pool): Promise<void> {
  for (const definition of SCHEDULER_JOB_DEFINITIONS) {
    const name = schedulerJobName(definition.key);
    await pool.query("SELECT cron.unschedule($1::text)", [name]);
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

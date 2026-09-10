import {
  assertProductionDatabaseUrl,
  buildProductionEnvironment,
  PRODUCTION_PROJECT_REF,
} from "../production-environment";
import { assertLocalDatabaseUrl, assertLocalHttpUrl, parseLocalSupabaseStatus, type LocalSupabaseStatus } from "../local-environment";

export { PRODUCTION_PROJECT_REF } from "../production-environment";

const PRODUCTION_SUPABASE_URL = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
const RECOVERY_TARGET = "isolated" as const;

export type BackupClass = "hourly" | "daily" | "pre-release" | "manual";

const BACKUP_CLASSES: readonly BackupClass[] = ["hourly", "daily", "pre-release", "manual"];

export interface ProductionBackupEnvironment {
  databaseUrl: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  ageRecipient: string;
  r2: R2ObjectEnvironment;
}

export interface R2ObjectEnvironment {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface IsolatedRecoveryEnvironment {
  databaseUrl: string;
  supabase: LocalSupabaseStatus;
}

export function assertProductionBackupEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProductionBackupEnvironment {
  // This is deliberately the read-only production builder. It reuses the
  // existing project/host/database target guard without granting DB writes.
  const protectedEnvironment = buildProductionEnvironment(env, {
    requiresWriteAuthorization: false,
  });
  const supabaseUrl = assertProductionSupabaseUrl(
    env.RIVALHUB_PRODUCTION_SUPABASE_URL ?? PRODUCTION_SUPABASE_URL,
  );

  return {
    databaseUrl: assertProductionDatabaseUrl(protectedEnvironment.DATABASE_URL),
    supabaseUrl,
    serviceRoleKey: required(env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY"),
    ageRecipient: assertAgeRecipient(required(env.RIVALHUB_BACKUP_AGE_RECIPIENT, "RIVALHUB_BACKUP_AGE_RECIPIENT")),
    r2: {
      accountId: assertCloudflareAccountId(required(env.RIVALHUB_R2_ACCOUNT_ID, "RIVALHUB_R2_ACCOUNT_ID")),
      bucket: assertR2BucketName(required(env.RIVALHUB_R2_BUCKET, "RIVALHUB_R2_BUCKET")),
      accessKeyId: required(env.RIVALHUB_R2_ACCESS_KEY_ID, "RIVALHUB_R2_ACCESS_KEY_ID"),
      secretAccessKey: required(env.RIVALHUB_R2_SECRET_ACCESS_KEY, "RIVALHUB_R2_SECRET_ACCESS_KEY"),
    },
  };
}

function assertProductionSupabaseUrl(value: string | undefined): string {
  let url: URL;
  try {
    url = new URL(required(value, "RIVALHUB_PRODUCTION_SUPABASE_URL"));
  } catch {
    throw new Error("RIVALHUB_PRODUCTION_SUPABASE_URL 格式无效。 ");
  }
  const expected = new URL(PRODUCTION_SUPABASE_URL);
  if (
    url.protocol !== "https:"
    || url.hostname !== expected.hostname
    || url.port
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new Error("RIVALHUB_PRODUCTION_SUPABASE_URL 必须指向固定 production Supabase project origin。 ");
  }
  return url.origin;
}

function assertAgeRecipient(value: string): string {
  if (!/^age1[0-9a-z]+$/.test(value)) {
    throw new Error("RIVALHUB_BACKUP_AGE_RECIPIENT 必须是 age 公钥；backup runner 不接受 private key。 ");
  }
  return value;
}

export function assertCloudflareAccountId(value: string): string {
  if (!/^[a-f0-9]{32}$/i.test(value)) throw new Error("RIVALHUB_R2_ACCOUNT_ID 格式无效。 ");
  return value.toLowerCase();
}

export function assertR2BucketName(value: string): string {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value) || value.includes("..")) {
    throw new Error("RIVALHUB_R2_BUCKET 必须是有效的 R2 bucket name。 ");
  }
  return value;
}

export function assertBackupClass(value: string | undefined): BackupClass {
  if (!value || !BACKUP_CLASSES.includes(value as BackupClass)) {
    throw new Error(`backup class 必须是 ${BACKUP_CLASSES.join(" | ")}。`);
  }
  return value as BackupClass;
}

export function buildIsolatedRecoveryEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
  localStatus?: LocalSupabaseStatus,
): IsolatedRecoveryEnvironment {
  const databaseUrl = assertIsolatedRecoveryDatabaseUrl(env);
  const candidate = localStatus ?? buildLocalRecoverySupabaseStatus(env);
  const supabase: LocalSupabaseStatus = {
    ...candidate,
    apiUrl: assertRecoverySupabaseIsNotProduction(candidate.apiUrl),
  };
  if (supabase.databaseUrl !== databaseUrl) {
    throw new Error("Recovery database 与 Supabase status 不一致；拒绝继续。 ");
  }
  return { databaseUrl, supabase };
}

export function assertIsolatedRecoveryDatabaseUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (env.RIVALHUB_RECOVERY_TARGET !== RECOVERY_TARGET) {
    throw new Error("恢复目标必须显式设置 RIVALHUB_RECOVERY_TARGET=isolated。 ");
  }
  if (env.RIVALHUB_DB_TARGET && env.RIVALHUB_DB_TARGET !== "local") {
    throw new Error("隔离恢复只允许 local 数据库目标。 ");
  }
  if (env.RIVALHUB_ALLOW_REMOTE_DB_WRITE) {
    throw new Error("隔离恢复拒绝携带任何 remote DB write authorization。 ");
  }
  return assertLocalDatabaseUrl(
    env.RIVALHUB_RECOVERY_DATABASE_URL ?? env.DATABASE_URL,
    "RIVALHUB_RECOVERY_DATABASE_URL",
  );
}

function buildLocalRecoverySupabaseStatus(
  env: Readonly<Record<string, string | undefined>> = process.env,
): LocalSupabaseStatus {
  if (env.RIVALHUB_RECOVERY_USE_LOCAL_SUPABASE !== "1") {
    const apiUrl = assertLocalHttpUrl(
      env.RIVALHUB_RECOVERY_SUPABASE_URL,
      "RIVALHUB_RECOVERY_SUPABASE_URL",
    );
    return {
      apiUrl,
      databaseUrl: assertLocalDatabaseUrl(
        env.RIVALHUB_RECOVERY_DATABASE_URL ?? env.DATABASE_URL,
        "RIVALHUB_RECOVERY_DATABASE_URL",
      ),
      publishableKey: required(
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.RIVALHUB_RECOVERY_PUBLISHABLE_KEY,
        "RIVALHUB_RECOVERY_PUBLISHABLE_KEY/NEXT_PUBLIC_SUPABASE_ANON_KEY",
      ),
      serviceRoleKey: required(
        env.SUPABASE_SERVICE_ROLE_KEY ?? env.RIVALHUB_RECOVERY_SERVICE_ROLE_KEY,
        "RIVALHUB_RECOVERY_SERVICE_ROLE_KEY/SUPABASE_SERVICE_ROLE_KEY",
      ),
    };
  }

  // The caller supplies the parsed status so this fallback is only used by
  // the CLI after it has already queried `supabase status`.
  throw new Error("RIVALHUB_RECOVERY_USE_LOCAL_SUPABASE=1 需要由 recovery CLI 注入 Local Supabase status。 ");
}

function assertRecoverySupabaseIsNotProduction(apiUrl: string): string {
  const normalized = assertLocalHttpUrl(apiUrl, "RIVALHUB_RECOVERY_SUPABASE_URL");
  if (new URL(normalized).hostname === new URL(PRODUCTION_SUPABASE_URL).hostname) {
    throw new Error("隔离恢复拒绝 production Supabase API target。 ");
  }
  return normalized;
}

export function parseLocalRecoveryStatus(raw: string): LocalSupabaseStatus {
  return parseLocalSupabaseStatus(raw);
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} 未设置；拒绝继续。 `);
  return value.trim();
}

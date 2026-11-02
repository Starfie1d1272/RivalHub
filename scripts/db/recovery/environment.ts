import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertLocalContainerAccess } from "../local-container-guard";
import { OFFICIAL_PREVIEW, OFFICIAL_PRODUCTION } from "../../../src/lib/runtime/official-deployment-profile.mjs";
import { postgresConnection } from "../../../src/db/postgres-connection";
import { requireSupabasePublicKey, requireSupabaseSecretKey } from "../../../src/lib/runtime/supabase-keys";
import {
  assertProductionBackupDatabaseUrl,
  buildProductionEnvironment,
  deriveProductionBackupDatabaseUrl,
  PRODUCTION_PROJECT_REF,
} from "../production-environment";
import { assertLocalDatabaseUrl, assertLocalHttpUrl, parseLocalSupabaseStatus, type LocalSupabaseStatus } from "../local-environment";

export { PRODUCTION_PROJECT_REF } from "../production-environment";

const PRODUCTION_SUPABASE_URL = OFFICIAL_PRODUCTION.supabaseUrl;
const RECOVERY_TARGET = "isolated" as const;

/** Retain recovery compatibility with encrypted backups from the previous organization. */
export function isProductionRecoverySource(projectRef: string): boolean {
  return projectRef === PRODUCTION_PROJECT_REF || projectRef === "atjiukerfgqlwvnctigc" || projectRef === "eurxkguokrkvpcsmxuru" || projectRef === "rrrebbxfghmgnoyyeqqd" || projectRef === "sucokfotkypwqkckfynp";
}

export type BackupClass = "daily" | "pre-release" | "manual";
export type RecoveryArtifactClass = BackupClass | "release-db";
export type RecoveryArtifactKind = "full" | "db-checkpoint";

const BACKUP_CLASSES: readonly BackupClass[] = ["daily", "pre-release", "manual"];
const RECOVERY_ARTIFACT_CLASSES: readonly RecoveryArtifactClass[] = [...BACKUP_CLASSES, "release-db"];

export interface ProductionBackupEnvironment {
  databaseUrl: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
  ageRecipient: string;
  r2: R2ObjectEnvironment;
}

export interface ProductionDbCheckpointEnvironment {
  databaseUrl: string;
  ageRecipient: string;
  r2: R2ObjectEnvironment;
}

export interface R2ObjectEnvironment {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  localEndpoint?: string;
}

export interface IsolatedRecoveryEnvironment {
  databaseUrl: string;
  supabase: LocalSupabaseStatus;
}

export interface IsolatedRecoveryDatabaseEnvironment {
  databaseUrl: string;
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
  const backupDatabaseUrl = env.RIVALHUB_PRODUCTION_BACKUP_DATABASE_URL?.trim()
    || env.RIVALHUB_BACKUP_DATABASE_URL?.trim()
    ? assertProductionBackupDatabaseUrl(
        env.RIVALHUB_PRODUCTION_BACKUP_DATABASE_URL?.trim()
        || env.RIVALHUB_BACKUP_DATABASE_URL?.trim(),
      )
    : deriveProductionBackupDatabaseUrl(protectedEnvironment.DATABASE_URL);

  return {
    databaseUrl: backupDatabaseUrl,
    supabaseUrl,
    supabaseSecretKey: requireSupabaseSecretKey(env.SUPABASE_SECRET_KEY, supabaseUrl),
    ageRecipient: assertAgeRecipient(required(env.RIVALHUB_BACKUP_AGE_RECIPIENT, "RIVALHUB_BACKUP_AGE_RECIPIENT")),
    r2: {
      accountId: assertCloudflareAccountId(required(env.RIVALHUB_R2_ACCOUNT_ID, "RIVALHUB_R2_ACCOUNT_ID")),
      bucket: assertR2BucketName(required(env.RIVALHUB_R2_BUCKET, "RIVALHUB_R2_BUCKET")),
      accessKeyId: required(env.RIVALHUB_R2_ACCESS_KEY_ID, "RIVALHUB_R2_ACCESS_KEY_ID"),
      secretAccessKey: required(env.RIVALHUB_R2_SECRET_ACCESS_KEY, "RIVALHUB_R2_SECRET_ACCESS_KEY"),
    },
  };
}

/** Production DB-only checkpoint target; it deliberately has no Storage credential. */
/** Explicit non-official instance source; never inherits production defaults. */
/** Local-only full-flow source, discovered from the running provider, never a Hosted target. */
export function assertIsolatedInstanceBackupEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProductionBackupEnvironment & { projectRef: string; appOrigin: string } {
  if (env.RIVALHUB_DB_TARGET !== "local" || env.RIVALHUB_ALLOW_REMOTE_DB_WRITE) throw new Error("Isolated backup requires local-only configuration.");
  assertLocalContainerAccess("isolated instance recovery backup", env);
  const workdir = resolve(required(env.RIVALHUB_BACKUP_SUPABASE_WORKDIR, "RIVALHUB_BACKUP_SUPABASE_WORKDIR"));
  const status = spawnSync("pnpm", ["exec", "supabase", "status", "--workdir", workdir, "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (status.error || status.status !== 0) throw new Error("Local backup source status unavailable.");
  const local = parseLocalSupabaseStatus(status.stdout);
  const config = readFileSync(resolve(workdir, "supabase/config.toml"), "utf8");
  const projectRef = /^project_id\s*=\s*"([a-z]{20})"\s*$/m.exec(config)?.[1];
  if (!projectRef || isProductionRecoverySource(projectRef) || projectRef === OFFICIAL_PREVIEW.projectRef) throw new Error("Isolated source project identity invalid.");
  const r2 = assertRecoveryFetchEnvironment(env);
  if (!r2.localEndpoint) throw new Error("Isolated backup requires a loopback-only object storage fixture.");
  return {
    databaseUrl: local.databaseUrl, supabaseUrl: local.apiUrl, supabaseSecretKey: local.serviceRoleKey,
    projectRef, appOrigin: assertLocalHttpUrl(env.NEXT_PUBLIC_APP_URL, "NEXT_PUBLIC_APP_URL"),
    ageRecipient: assertAgeRecipient(required(env.RIVALHUB_BACKUP_AGE_RECIPIENT, "RIVALHUB_BACKUP_AGE_RECIPIENT")),
    r2,
  };
}

export function assertInstanceBackupEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProductionBackupEnvironment & { projectRef: string; appOrigin: string } {
  const projectRef = required(env.RIVALHUB_INSTANCE_PROJECT_REF, "RIVALHUB_INSTANCE_PROJECT_REF");
  if (!/^[a-z]{20}$/.test(projectRef) || isProductionRecoverySource(projectRef) || projectRef === OFFICIAL_PREVIEW.projectRef
    || env.RIVALHUB_INSTANCE_CONFIRM !== projectRef) throw new Error("Confirmed non-official instance project required.");
  const supabaseUrl = required(env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
  if (supabaseUrl !== `https://${projectRef}.supabase.co`) throw new Error("Instance Supabase API identity mismatch.");
  const databaseUrl = required(env.DATABASE_URL, "DATABASE_URL");
  let db: URL;
  try { db = new URL(databaseUrl); } catch { throw new Error("Instance database URL invalid."); }
  const direct = db.hostname === `db.${projectRef}.supabase.co` && (!db.port || db.port === "5432");
  const pooler = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(db.hostname)
    && decodeURIComponent(db.username) === `postgres.${projectRef}` && (!db.port || db.port === "5432");
  if ((!direct && !pooler) || db.pathname !== "/postgres" || db.hash
    || [...db.searchParams.keys()].some(key => key !== "sslmode")) throw new Error("Instance backup database identity mismatch.");
  postgresConnection(databaseUrl);
  return {
    databaseUrl, supabaseUrl, projectRef,
    appOrigin: required(env.NEXT_PUBLIC_APP_URL, "NEXT_PUBLIC_APP_URL"),
    supabaseSecretKey: requireSupabaseSecretKey(env.SUPABASE_SECRET_KEY, supabaseUrl),
    ageRecipient: assertAgeRecipient(required(env.RIVALHUB_BACKUP_AGE_RECIPIENT, "RIVALHUB_BACKUP_AGE_RECIPIENT")),
    r2: assertRecoveryFetchEnvironment(env),
  };
}

export function assertProductionDbCheckpointEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProductionDbCheckpointEnvironment {
  const protectedEnvironment = buildProductionEnvironment(env, {
    requiresWriteAuthorization: false,
  });
  const databaseUrl = env.RIVALHUB_PRODUCTION_BACKUP_DATABASE_URL?.trim()
    || env.RIVALHUB_BACKUP_DATABASE_URL?.trim()
    ? assertProductionBackupDatabaseUrl(
        env.RIVALHUB_PRODUCTION_BACKUP_DATABASE_URL?.trim()
        || env.RIVALHUB_BACKUP_DATABASE_URL?.trim(),
      )
    : deriveProductionBackupDatabaseUrl(protectedEnvironment.DATABASE_URL);

  return {
    databaseUrl,
    ageRecipient: assertAgeRecipient(required(env.RIVALHUB_BACKUP_AGE_RECIPIENT, "RIVALHUB_BACKUP_AGE_RECIPIENT")),
    r2: {
      accountId: assertCloudflareAccountId(required(env.RIVALHUB_R2_ACCOUNT_ID, "RIVALHUB_R2_ACCOUNT_ID")),
      bucket: assertR2BucketName(required(env.RIVALHUB_R2_BUCKET, "RIVALHUB_R2_BUCKET")),
      accessKeyId: required(env.RIVALHUB_R2_ACCESS_KEY_ID, "RIVALHUB_R2_ACCESS_KEY_ID"),
      secretAccessKey: required(env.RIVALHUB_R2_SECRET_ACCESS_KEY, "RIVALHUB_R2_SECRET_ACCESS_KEY"),
    },
  };
}

export function assertRecoveryFetchEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): R2ObjectEnvironment {
  const requestedLocal = env.RIVALHUB_R2_LOCAL_ENDPOINT?.trim();
  const isolatedOperation = env.RIVALHUB_BACKUP_SOURCE === "isolated-instance"
    || (!env.RIVALHUB_BACKUP_SOURCE && env.RIVALHUB_RECOVERY_TARGET === "isolated");
  if (requestedLocal && (env.RIVALHUB_DB_TARGET !== "local" || env.RIVALHUB_ALLOW_REMOTE_DB_WRITE || !isolatedOperation)) {
    throw new Error("Local object storage is restricted to isolated recovery.");
  }
  const localEndpoint = requestedLocal ? assertLocalHttpUrl(requestedLocal, "RIVALHUB_R2_LOCAL_ENDPOINT") : undefined;
  if (localEndpoint) {
    const url = new URL(localEndpoint);
    if (url.origin !== localEndpoint || url.username || url.password) throw new Error("Local object storage endpoint must be an origin.");
  }
  return {
    accountId: assertCloudflareAccountId(required(env.RIVALHUB_R2_ACCOUNT_ID, "RIVALHUB_R2_ACCOUNT_ID")),
    bucket: assertR2BucketName(required(env.RIVALHUB_R2_BUCKET, "RIVALHUB_R2_BUCKET")),
    accessKeyId: required(env.RIVALHUB_R2_ACCESS_KEY_ID, "RIVALHUB_R2_ACCESS_KEY_ID"),
    secretAccessKey: required(env.RIVALHUB_R2_SECRET_ACCESS_KEY, "RIVALHUB_R2_SECRET_ACCESS_KEY"),
    ...(localEndpoint ? { localEndpoint } : {}),
  };
}

export function assertProductionSupabaseUrl(value: string | undefined): string {
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

export function assertRecoveryArtifactClass(value: string | undefined): RecoveryArtifactClass {
  if (!value || !RECOVERY_ARTIFACT_CLASSES.includes(value as RecoveryArtifactClass)) {
    throw new Error(`recovery artifact class 必须是 ${RECOVERY_ARTIFACT_CLASSES.join(" | ")}。`);
  }
  return value as RecoveryArtifactClass;
}

export function recoveryArtifactKindForClass(value: RecoveryArtifactClass): RecoveryArtifactKind {
  return value === "release-db" ? "db-checkpoint" : "full";
}

export function assertRecoveryArtifactKind(value: string | undefined): RecoveryArtifactKind {
  if (value !== "full" && value !== "db-checkpoint") {
    throw new Error("recovery artifact kind 必须是 full | db-checkpoint。 ");
  }
  return value;
}

/** Explicitly targeted fresh non-official Hosted instance; never an official project. */
export function buildInstanceRecoveryEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): IsolatedRecoveryEnvironment {
  if (env.RIVALHUB_RECOVERY_TARGET !== "instance" || env.RIVALHUB_INSTANCE_WRITE !== "yes") {
    throw new Error("Explicit instance recovery write target required.");
  }
  const project = required(env.RIVALHUB_INSTANCE_PROJECT_REF, "RIVALHUB_INSTANCE_PROJECT_REF");
  if (!/^[a-z]{20}$/.test(project) || isProductionRecoverySource(project) || project === OFFICIAL_PREVIEW.projectRef
    || env.RIVALHUB_INSTANCE_CONFIRM !== project) throw new Error("Confirmed non-official recovery project required.");
  const apiUrl = required(env.RIVALHUB_RECOVERY_SUPABASE_URL, "RIVALHUB_RECOVERY_SUPABASE_URL");
  if (apiUrl !== `https://${project}.supabase.co`) throw new Error("Recovery API project identity mismatch.");
  const databaseUrl = required(env.RIVALHUB_RECOVERY_DATABASE_URL, "RIVALHUB_RECOVERY_DATABASE_URL");
  let db: URL;
  try { db = new URL(databaseUrl); } catch { throw new Error("Recovery database URL invalid."); }
  const direct = db.hostname === `db.${project}.supabase.co` && (!db.port || db.port === "5432");
  const pooled = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(db.hostname)
    && decodeURIComponent(db.username) === `postgres.${project}` && (!db.port || db.port === "5432");
  if ((!direct && !pooled) || db.pathname !== "/postgres" || db.hash
    || [...db.searchParams.keys()].some(key => key !== "sslmode")) throw new Error("Recovery database project identity mismatch.");
  postgresConnection(databaseUrl);
  return { databaseUrl, supabase: {
    apiUrl, databaseUrl,
    publishableKey: requireSupabasePublicKey(env.RIVALHUB_RECOVERY_PUBLISHABLE_KEY, apiUrl),
    serviceRoleKey: requireSupabaseSecretKey(env.RIVALHUB_RECOVERY_SERVICE_ROLE_KEY, apiUrl),
  } };
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

export function buildIsolatedRecoveryDatabaseEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): IsolatedRecoveryDatabaseEnvironment {
  return { databaseUrl: assertIsolatedRecoveryDatabaseUrl(env) };
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
        env.RIVALHUB_RECOVERY_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        "RIVALHUB_RECOVERY_PUBLISHABLE_KEY/NEXT_PUBLIC_SUPABASE_ANON_KEY",
      ),
      serviceRoleKey: required(
        env.RIVALHUB_RECOVERY_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY,
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

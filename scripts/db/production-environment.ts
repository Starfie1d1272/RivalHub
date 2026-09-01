import {
  assertProtectedRemoteDatabaseUrl,
  assertRemoteConfirmations,
  sanitizedRemoteEnvironment,
  type Environment,
  type ProtectedRemoteDatabaseConfig,
} from "./remote-environment";

export const PRODUCTION_PROJECT_REF = "sucokfotkypwqkckfynp";
export const PRODUCTION_POOLER_HOST = "aws-0-ap-northeast-1.pooler.supabase.com";
export const PRODUCTION_POOLER_PORT = "6543";

const productionConfig: ProtectedRemoteDatabaseConfig = {
  target: "production",
  projectRef: PRODUCTION_PROJECT_REF,
  poolerHost: PRODUCTION_POOLER_HOST,
  poolerPort: PRODUCTION_POOLER_PORT,
  requiresPgbouncer: true,
  projectConfirmationKey: "RIVALHUB_PRODUCTION_PROJECT_CONFIRM",
  hostConfirmationKey: "RIVALHUB_PRODUCTION_DB_HOST_CONFIRM",
  databaseUrlKey: "RIVALHUB_PRODUCTION_DATABASE_URL",
  requireExplicitTarget: true,
};

export function buildProductionEnvironment(
  env: Environment = process.env,
  options: { requiresWriteAuthorization: boolean },
): NodeJS.ProcessEnv {
  if (env.RIVALHUB_DB_TARGET !== "production") {
    throw new Error("必须显式设置 RIVALHUB_DB_TARGET=production。");
  }
  assertRemoteConfirmations(env, productionConfig);
  if (options.requiresWriteAuthorization && env.RIVALHUB_ALLOW_REMOTE_DB_WRITE !== "production") {
    throw new Error("远程 production migration 未授权；必须显式设置 RIVALHUB_ALLOW_REMOTE_DB_WRITE=production。");
  }

  const databaseUrl = normalizeProductionDatabaseUrl(env.DATABASE_URL);
  const sanitized = sanitizedRemoteEnvironment(env);
  return {
    ...sanitized,
    NODE_ENV: sanitized.NODE_ENV === "test" ? "test" : "production",
    DATABASE_URL: databaseUrl,
    RIVALHUB_PRODUCTION_DATABASE_URL: databaseUrl,
    RIVALHUB_DB_TARGET: "production",
    RIVALHUB_PRODUCTION_PROJECT_CONFIRM: PRODUCTION_PROJECT_REF,
    RIVALHUB_PRODUCTION_DB_HOST_CONFIRM: `${PRODUCTION_POOLER_HOST}:${PRODUCTION_POOLER_PORT}`,
  };
}

export function assertProductionDatabaseUrl(value: string | undefined): string {
  return assertProtectedRemoteDatabaseUrl(value, productionConfig);
}

export function assertProductionConfirmations(env: Environment = process.env): void {
  if (env.RIVALHUB_DB_TARGET !== "production") {
    throw new Error("Migration verification 的 production 目标必须显式设置 RIVALHUB_DB_TARGET=production。");
  }
  assertRemoteConfirmations(env, productionConfig);
}

/** Vercel production builds inherit the same runtime Transaction Pooler URL used by the app. */
export function buildVercelProductionVerificationEnvironment(env: Environment = process.env): NodeJS.ProcessEnv {
  if (env.VERCEL_ENV !== "production") {
    throw new Error("Vercel production migration gate 只能在 VERCEL_ENV=production 运行。");
  }
  const databaseUrl = normalizeProductionDatabaseUrl(env.DATABASE_URL);
  return {
    ...env,
    NODE_ENV: "production",
    DATABASE_URL: databaseUrl,
    RIVALHUB_DB_TARGET: "production",
    RIVALHUB_PRODUCTION_PROJECT_CONFIRM: PRODUCTION_PROJECT_REF,
    RIVALHUB_PRODUCTION_DB_HOST_CONFIRM: `${PRODUCTION_POOLER_HOST}:${PRODUCTION_POOLER_PORT}`,
  };
}

function normalizeProductionDatabaseUrl(value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error("DATABASE_URL 未设置；production migration/verify 复用现有 production runtime credential，不维护第二份数据库密码。");
  }

  let runtimeUrl: URL;
  try {
    runtimeUrl = new URL(value.trim());
  } catch {
    throw new Error("Production DATABASE_URL 格式无效。");
  }

  // Supabase runtime Transaction Pooler URLs may omit this marker. Normalize
  // only its absence; an explicitly conflicting value remains fail-closed.
  if (!runtimeUrl.searchParams.has("pgbouncer")) runtimeUrl.searchParams.set("pgbouncer", "true");
  return assertProductionDatabaseUrl(runtimeUrl.toString());
}

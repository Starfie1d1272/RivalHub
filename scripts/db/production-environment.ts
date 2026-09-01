import {
  assertProtectedRemoteDatabaseUrl,
  assertRemoteConfirmations,
  buildProtectedRemoteEnvironment,
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
  passwordKey: "RIVALHUB_PRODUCTION_DB_PASSWORD",
  projectConfirmationKey: "RIVALHUB_PRODUCTION_PROJECT_CONFIRM",
  hostConfirmationKey: "RIVALHUB_PRODUCTION_DB_HOST_CONFIRM",
  databaseUrlKey: "RIVALHUB_PRODUCTION_DATABASE_URL",
  requireExplicitTarget: true,
};

export function buildProductionEnvironment(
  env: Environment = process.env,
  options: { requiresWriteAuthorization: boolean },
): NodeJS.ProcessEnv {
  return buildProtectedRemoteEnvironment(env, productionConfig, options);
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

/** Vercel production builds inherit the already-configured runtime Transaction Pooler URL. */
export function buildVercelProductionVerificationEnvironment(env: Environment = process.env): NodeJS.ProcessEnv {
  if (env.VERCEL_ENV !== "production") {
    throw new Error("Vercel production migration gate 只能在 VERCEL_ENV=production 运行。");
  }
  if (!env.DATABASE_URL?.trim()) {
    throw new Error("Vercel production migration gate 缺少 DATABASE_URL。");
  }

  let runtimeUrl: URL;
  try {
    runtimeUrl = new URL(env.DATABASE_URL.trim());
  } catch {
    throw new Error("Vercel production DATABASE_URL 格式无效。");
  }

  // Supabase's runtime Transaction Pooler URL may omit this query flag even
  // though the protected migration path records it explicitly. Missing is
  // normalized; an explicitly conflicting value still fails closed below.
  if (!runtimeUrl.searchParams.has("pgbouncer")) runtimeUrl.searchParams.set("pgbouncer", "true");
  const databaseUrl = assertProductionDatabaseUrl(runtimeUrl.toString());

  return {
    ...env,
    NODE_ENV: "production",
    DATABASE_URL: databaseUrl,
    RIVALHUB_DB_TARGET: "production",
    RIVALHUB_PRODUCTION_PROJECT_CONFIRM: PRODUCTION_PROJECT_REF,
    RIVALHUB_PRODUCTION_DB_HOST_CONFIRM: `${PRODUCTION_POOLER_HOST}:${PRODUCTION_POOLER_PORT}`,
  };
}

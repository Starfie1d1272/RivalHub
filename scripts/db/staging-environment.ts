const STAGING_PROJECT_REF = "cueazphyskstwdhnzsxx";
const STAGING_POOLER_HOST = "aws-0-ap-northeast-1.pooler.supabase.com";
const STAGING_POOLER_PORT = "6543";

type Environment = Readonly<Record<string, string | undefined>>;

export { STAGING_PROJECT_REF };

export function buildStagingEnvironment(
  env: Environment = process.env,
  options: { requiresWriteAuthorization: boolean },
): NodeJS.ProcessEnv {
  if (env.DATABASE_URL?.trim()) {
    throw new Error(
      "db:staging:* 不接受 DATABASE_URL；拒绝从 shell、.env 或生产连接串继承远程目标。",
    );
  }
  if (env.RIVALHUB_DB_TARGET && env.RIVALHUB_DB_TARGET !== "staging") {
    throw new Error("db:staging:* 只允许 staging 目标；拒绝 production 或未声明目标。");
  }
  if (env.RIVALHUB_STAGING_PROJECT_CONFIRM !== STAGING_PROJECT_REF) {
    throw new Error(
      `必须显式设置 RIVALHUB_STAGING_PROJECT_CONFIRM=${STAGING_PROJECT_REF}。`,
    );
  }
  if (
    options.requiresWriteAuthorization &&
    env.RIVALHUB_ALLOW_REMOTE_DB_WRITE !== "staging"
  ) {
    throw new Error(
      "远程 staging migration 未授权；必须显式设置 RIVALHUB_ALLOW_REMOTE_DB_WRITE=staging。",
    );
  }

  const databaseUrl = buildStagingDatabaseUrl(env.RIVALHUB_STAGING_DB_PASSWORD);
  const sanitized = sanitizedEnvironment(env);

  return {
    ...sanitized,
    NODE_ENV: sanitized.NODE_ENV === "test" ? "test" : "production",
    DATABASE_URL: databaseUrl,
    RIVALHUB_STAGING_DATABASE_URL: databaseUrl,
    RIVALHUB_DB_TARGET: "staging",
  };
}

export function assertStagingDatabaseUrl(value: string | undefined): string {
  const url = parseUrl(value, "RIVALHUB_STAGING_DATABASE_URL");
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("RIVALHUB_STAGING_DATABASE_URL 协议不受支持。");
  }
  if (url.hostname !== STAGING_POOLER_HOST || url.port !== STAGING_POOLER_PORT) {
    throw new Error("RIVALHUB_STAGING_DATABASE_URL 未指向固定的 rivalhub-dev Transaction Pooler。");
  }
  if (decodeURIComponent(url.username) !== `postgres.${STAGING_PROJECT_REF}`) {
    throw new Error("RIVALHUB_STAGING_DATABASE_URL 的 project ref 不匹配；已拒绝。");
  }
  if (url.pathname !== "/postgres" || url.searchParams.get("pgbouncer") !== "true") {
    throw new Error("RIVALHUB_STAGING_DATABASE_URL 必须使用 rivalhub-dev 的 Transaction Pooler 格式。");
  }
  if (!url.password) {
    throw new Error("RIVALHUB_STAGING_DATABASE_URL 缺少数据库密码。");
  }
  return url.toString();
}

function buildStagingDatabaseUrl(password: string | undefined): string {
  if (!password?.trim()) {
    throw new Error("RIVALHUB_STAGING_DB_PASSWORD 未设置；拒绝猜测或回退到其他凭据。");
  }
  return assertStagingDatabaseUrl(
    `postgresql://postgres.${STAGING_PROJECT_REF}:${encodeURIComponent(password.trim())}@${STAGING_POOLER_HOST}:${STAGING_POOLER_PORT}/postgres?pgbouncer=true`,
  );
}

function sanitizedEnvironment(env: Environment): Record<string, string | undefined> {
  const result = { ...env };
  for (const key of [
    "DATABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_DB_PASSWORD",
    "SUPABASE_PROJECT_ID",
    "RIVALHUB_DB_TARGET",
    "RIVALHUB_DB_HOST_CONFIRM",
    "RIVALHUB_ALLOW_REMOTE_DB_WRITE",
    "RIVALHUB_STAGING_DB_PASSWORD",
    "RIVALHUB_STAGING_DATABASE_URL",
  ]) {
    delete result[key];
  }
  return result;
}

function parseUrl(value: string | undefined, label: string): URL {
  if (!value?.trim()) throw new Error(`${label} 未设置。`);
  try {
    return new URL(value.trim());
  } catch {
    throw new Error(`${label} 格式无效。`);
  }
}

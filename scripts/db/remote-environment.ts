export type Environment = Readonly<Record<string, string | undefined>>;

export interface ProtectedRemoteDatabaseConfig {
  target: "staging" | "production";
  projectRef: string;
  poolerHost: string;
  poolerPort: string;
  requiresPgbouncer: boolean;
  passwordKey: string;
  projectConfirmationKey: string;
  hostConfirmationKey?: string;
  databaseUrlKey: string;
  requireExplicitTarget: boolean;
}

export function buildProtectedRemoteEnvironment(
  env: Environment,
  config: ProtectedRemoteDatabaseConfig,
  options: { requiresWriteAuthorization: boolean },
): NodeJS.ProcessEnv {
  if (env.DATABASE_URL?.trim()) {
    throw new Error(`db:${config.target}:* 不接受 DATABASE_URL；拒绝从 shell、.env 或其他远程连接串继承目标。`);
  }
  if (config.requireExplicitTarget && env.RIVALHUB_DB_TARGET !== config.target) {
    throw new Error(`必须显式设置 RIVALHUB_DB_TARGET=${config.target}。`);
  }
  if (env.RIVALHUB_DB_TARGET && env.RIVALHUB_DB_TARGET !== config.target) {
    throw new Error(`db:${config.target}:* 只允许 ${config.target} 目标；拒绝其他环境。`);
  }
  assertRemoteConfirmations(env, config);
  if (options.requiresWriteAuthorization && env.RIVALHUB_ALLOW_REMOTE_DB_WRITE !== config.target) {
    throw new Error(`远程 ${config.target} migration 未授权；必须显式设置 RIVALHUB_ALLOW_REMOTE_DB_WRITE=${config.target}。`);
  }

  const password = env[config.passwordKey];
  if (!password?.trim()) {
    throw new Error(`${config.passwordKey} 未设置；拒绝猜测或回退到其他凭据。`);
  }
  const databaseUrl = assertProtectedRemoteDatabaseUrl(
    `postgresql://postgres.${config.projectRef}:${encodeURIComponent(password.trim())}@${config.poolerHost}:${config.poolerPort}/postgres${config.requiresPgbouncer ? "?pgbouncer=true" : ""}`,
    config,
  );
  const sanitized = sanitizedRemoteEnvironment(env);
  return {
    ...sanitized,
    NODE_ENV: sanitized.NODE_ENV === "test" ? "test" : "production",
    DATABASE_URL: databaseUrl,
    [config.databaseUrlKey]: databaseUrl,
    RIVALHUB_DB_TARGET: config.target,
  };
}

export function assertRemoteConfirmations(env: Environment, config: ProtectedRemoteDatabaseConfig): void {
  if (env[config.projectConfirmationKey] !== config.projectRef) {
    throw new Error(`必须显式设置 ${config.projectConfirmationKey}=${config.projectRef}。`);
  }
  if (config.hostConfirmationKey) {
    const expectedHost = `${config.poolerHost}:${config.poolerPort}`;
    if (env[config.hostConfirmationKey] !== expectedHost) {
      throw new Error(`必须显式设置 ${config.hostConfirmationKey}=${expectedHost}。`);
    }
  }
}

export function assertProtectedRemoteDatabaseUrl(
  value: string | undefined,
  config: ProtectedRemoteDatabaseConfig,
): string {
  const url = parseUrl(value, config.databaseUrlKey);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`${config.databaseUrlKey} 协议不受支持。`);
  }
  if (url.hostname !== config.poolerHost || url.port !== config.poolerPort) {
    const targetLabel = config.target === "staging" ? "rivalhub-dev" : config.target;
    throw new Error(`${config.databaseUrlKey} 未指向固定的 ${targetLabel} Transaction Pooler。`);
  }
  if (decodeURIComponent(url.username) !== `postgres.${config.projectRef}`) {
    throw new Error(`${config.databaseUrlKey} 的 project ref 不匹配；已拒绝。`);
  }
  if (url.pathname !== "/postgres" || (config.requiresPgbouncer && url.searchParams.get("pgbouncer") !== "true")) {
    throw new Error(`${config.databaseUrlKey} 必须使用固定的 ${config.target} pooler 格式。`);
  }
  if (!url.password) {
    throw new Error(`${config.databaseUrlKey} 缺少数据库密码。`);
  }
  return url.toString();
}

export function sanitizedRemoteEnvironment(env: Environment): Record<string, string | undefined> {
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
    "RIVALHUB_PRODUCTION_DB_PASSWORD",
    "RIVALHUB_PRODUCTION_DATABASE_URL",
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

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const DATABASE_PROTOCOLS = new Set(["postgres:", "postgresql:"]);
const HTTP_PROTOCOLS = new Set(["http:", "https:"]);
// Cloudflare's documented always-pass pair. These are used only by the
// loopback-only Local Supabase/dev command and are never read by deployments.
const LOCAL_TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
const LOCAL_TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";

type Environment = Readonly<Record<string, string | undefined>>;

export interface LocalSupabaseStatus {
  databaseUrl: string;
  apiUrl: string;
  publishableKey: string;
  serviceRoleKey: string;
  studioUrl?: string;
}

export function assertLocalDatabaseUrl(
  value: string | undefined,
  label = "DATABASE_URL",
): string {
  return assertLoopbackUrl(value, label, DATABASE_PROTOCOLS).toString();
}

export function assertLocalHttpUrl(
  value: string | undefined,
  label: string,
): string {
  return assertLoopbackUrl(value, label, HTTP_PROTOCOLS).toString().replace(/\/$/, "");
}

export function parseLocalSupabaseStatus(raw: string): LocalSupabaseStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("无法解析 Local Supabase 状态；请确认本地栈已启动。");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Local Supabase 状态格式无效。");
  }

  const values = parsed as Record<string, unknown>;
  const databaseUrl = assertLocalDatabaseUrl(stringValue(values.DB_URL), "Supabase DB_URL");
  const apiUrl = assertLocalHttpUrl(stringValue(values.API_URL), "Supabase API_URL");
  const publishableKey = requiredString(
    stringValue(values.PUBLISHABLE_KEY) ?? stringValue(values.ANON_KEY),
    "Supabase PUBLISHABLE_KEY/ANON_KEY",
  );
  const serviceRoleKey = requiredString(
    stringValue(values.SERVICE_ROLE_KEY),
    "Supabase SERVICE_ROLE_KEY",
  );
  const studioUrlValue = stringValue(values.STUDIO_URL);

  return {
    databaseUrl,
    apiUrl,
    publishableKey,
    serviceRoleKey,
    studioUrl: studioUrlValue
      ? assertLocalHttpUrl(studioUrlValue, "Supabase STUDIO_URL")
      : undefined,
  };
}

export function buildLocalAppEnvironment(
  status: LocalSupabaseStatus,
  base: Environment = process.env,
): NodeJS.ProcessEnv {
  const nodeEnv =
    base.NODE_ENV === "production" || base.NODE_ENV === "test"
      ? base.NODE_ENV
      : "development";
  return {
    ...base,
    NODE_ENV: nodeEnv,
    DATABASE_URL: status.databaseUrl,
    NEXT_PUBLIC_SUPABASE_URL: status.apiUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: status.publishableKey,
    SUPABASE_SERVICE_ROLE_KEY: status.serviceRoleKey,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: LOCAL_TURNSTILE_SITE_KEY,
    TURNSTILE_SECRET_KEY: LOCAL_TURNSTILE_SECRET_KEY,
    ADMIN_SESSION_SECRET:
      "rivalhub-local-only-admin-session-secret-never-use-in-production",
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
    RIVALHUB_DB_TARGET: "local",
    RIVALHUB_LOCAL_DATABASE_URL: status.databaseUrl,
  };
}

export function assertDeclaredDatabaseTarget(env: Environment): void {
  const target = env.RIVALHUB_DB_TARGET;
  const databaseUrl = requiredString(env.DATABASE_URL, "DATABASE_URL");

  if (target === "local") {
    assertLocalDatabaseUrl(databaseUrl);
    return;
  }

  if (target !== "staging" && target !== "production") {
    throw new Error(
      "数据库写入目标未声明。请显式设置 RIVALHUB_DB_TARGET=local|staging|production。",
    );
  }

  const url = parseUrl(databaseUrl, "DATABASE_URL");
  const confirmedHost = requiredString(
    env.RIVALHUB_DB_HOST_CONFIRM,
    "RIVALHUB_DB_HOST_CONFIRM",
  );
  if (confirmedHost !== url.host) {
    throw new Error("RIVALHUB_DB_HOST_CONFIRM 必须与 DATABASE_URL 的 host:port 完全一致。");
  }
  if (env.RIVALHUB_ALLOW_REMOTE_DB_WRITE !== target) {
    throw new Error(
      `远程数据库写入未授权；必须显式设置 RIVALHUB_ALLOW_REMOTE_DB_WRITE=${target}。`,
    );
  }
}

function assertLoopbackUrl(
  value: string | undefined,
  label: string,
  protocols: ReadonlySet<string>,
): URL {
  const url = parseUrl(requiredString(value, label), label);
  if (!protocols.has(url.protocol)) {
    throw new Error(`${label} 协议不受支持。`);
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`${label} 必须指向 localhost、127.0.0.1 或 ::1；当前目标已拒绝。`);
  }
  return url;
}

function parseUrl(value: string, label: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${label} 格式无效。`);
  }
}

function requiredString(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} 未设置。`);
  return value.trim();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

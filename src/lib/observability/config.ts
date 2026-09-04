export const OBSERVABILITY_SERVICE_NAME = "rivalhub";

export type RuntimeEnvironment = "development" | "test" | "preview" | "production" | "unknown";

export interface BetterStackConfig {
  baseUrl: string;
  tracesUrl: string;
  logsUrl: string;
  headers: Readonly<Record<string, string>>;
}

export interface BetterStackConfigResult {
  enabled: boolean;
  reason: "enabled" | "environment_disabled" | "missing_credentials" | "invalid_credentials";
  environment: RuntimeEnvironment;
  config?: BetterStackConfig;
}

type Environment = Record<string, string | undefined>;

const EXTERNAL_ENVIRONMENTS = new Set<RuntimeEnvironment>(["preview", "production"]);

function getRuntimeEnvironment(env: Environment = runtimeEnvironment()): RuntimeEnvironment {
  const vercelEnvironment = env.VERCEL_ENV?.trim().toLowerCase();
  if (vercelEnvironment === "preview" || vercelEnvironment === "production") {
    return vercelEnvironment;
  }

  const nodeEnvironment = env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnvironment === "development" || nodeEnvironment === "test" || nodeEnvironment === "production") {
    return nodeEnvironment;
  }

  return "unknown";
}

export function getBetterStackConfig(env: Environment = runtimeEnvironment()): BetterStackConfigResult {
  const environment = getRuntimeEnvironment(env);
  if (!EXTERNAL_ENVIRONMENTS.has(environment)) {
    return { enabled: false, reason: "environment_disabled", environment };
  }

  const rawToken = env.BETTER_STACK_SOURCE_TOKEN;
  const token = rawToken?.trim();
  const host = env.BETTER_STACK_INGESTING_HOST?.trim();
  if (!token || !host) {
    return { enabled: false, reason: "missing_credentials", environment };
  }

  if (/[\r\n]/.test(rawToken ?? "")) {
    return { enabled: false, reason: "invalid_credentials", environment };
  }

  const baseUrl = normalizeIngestingHost(host);
  if (!baseUrl) {
    return { enabled: false, reason: "invalid_credentials", environment };
  }

  return {
    enabled: true,
    reason: "enabled",
    environment,
    config: {
      baseUrl,
      tracesUrl: `${baseUrl}/v1/traces`,
      logsUrl: `${baseUrl}/v1/logs`,
      headers: { Authorization: `Bearer ${token}` },
    },
  };
}

function normalizeIngestingHost(host: string): string | null {
  const candidate = host.includes("://") ? host : `https://${host}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) {
      return null;
    }
    if (url.pathname !== "/" && url.pathname !== "") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function runtimeEnvironment(): Environment {
  return typeof process === "undefined" ? {} : process.env;
}

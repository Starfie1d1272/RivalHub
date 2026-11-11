import { OFFICIAL_PREVIEW, OFFICIAL_PRODUCTION } from "../../../src/lib/runtime/official-deployment-profile.mjs";
import type { Environment } from "../remote-environment";
import { buildStagingEnvironment, STAGING_PROJECT_REF } from "../staging-environment";

export function assertRefreshRunner(env: Environment = process.env): void {
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_REPOSITORY !== "Starfie1d1272/RivalHub"
    || env.GITHUB_REF !== "refs/heads/main" || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_WORKFLOW_REF !== "Starfie1d1272/RivalHub/.github/workflows/refresh-preview-mirror.yml@refs/heads/main") {
    throw new Error("Mirror refresh must be dispatched from the protected main workflow.");
  }
}

export function sourceDatabaseUrl(env: Environment = process.env): string {
  assertRefreshRunner(env);
  if (env.RIVALHUB_ALLOW_REMOTE_DB_WRITE) throw new Error("Mirror source does not accept remote-write authority.");
  const { projectRef, poolerHost, sessionPoolerPort } = OFFICIAL_PRODUCTION;
  if (env.RIVALHUB_DB_TARGET !== "production" || env.RIVALHUB_PRODUCTION_PROJECT_CONFIRM !== projectRef ||
    env.RIVALHUB_PRODUCTION_DB_HOST_CONFIRM !== `${poolerHost}:${sessionPoolerPort}`) {
    throw new Error("Preview source must be the official production session pooler.");
  }
  const password = env.RIVALHUB_PREVIEW_DB_PASSWORD;
  if (!password) throw new Error("Preview source reader password is not configured.");
  return `postgresql://rivalhub_preview_exporter.${projectRef}:${encodeURIComponent(password)}@${poolerHost}:${sessionPoolerPort}/postgres`;
}

export function targetEnvironment(env: Environment = process.env) {
  assertRefreshRunner(env);
  if (env.RIVALHUB_PREVIEW_RESET_CONFIRM !== STAGING_PROJECT_REF) throw new Error("Explicit dev mirror reset confirmation required.");
  const databaseUrl = buildStagingEnvironment(env, { requiresWriteAuthorization: true }).DATABASE_URL!;
  const secretKey = env.RIVALHUB_PREVIEW_DEV_SECRET_KEY;
  if (!secretKey) throw new Error("Mirror dev Auth credential must be provisioned first.");
  return {
    databaseUrl,
    secretKey,
    migrationsDirectory: env.RIVALHUB_PREVIEW_APPLY_CURRENT_MIGRATIONS === "true"
      ? env.RIVALHUB_PREVIEW_MIGRATIONS_DIR ?? "drizzle/migrations"
      : null,
    supabaseUrl: OFFICIAL_PREVIEW.supabaseUrl,
  };
}

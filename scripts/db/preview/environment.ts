import { buildProductionEnvironment } from "../production-environment";
import { buildStagingEnvironment, STAGING_PROJECT_REF } from "../staging-environment";

export function assertRefreshRunner(env: NodeJS.ProcessEnv = process.env): void {
  const isManual = env.GITHUB_EVENT_NAME === "workflow_dispatch";
  const migrationRef = env.RIVALHUB_PREVIEW_MIGRATION_REF;
  let expectedRef = "refs/heads/main";
  if (isManual && migrationRef) {
    expectedRef = migrationRef.startsWith("refs/heads/") ? migrationRef : `refs/heads/${migrationRef}`;
  } else if (isManual) {
    expectedRef = "";
  }
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_REPOSITORY !== "Starfie1d1272/RivalHub"
    || env.GITHUB_REF !== expectedRef || env.GITHUB_WORKFLOW !== "Refresh Preview Data"
    || !["schedule", "workflow_dispatch", "workflow_run"].includes(env.GITHUB_EVENT_NAME ?? "")) {
    throw new Error("Mirror refresh only runs from an approved main or manual policy ref.");
  }
}

export function sourceDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  assertRefreshRunner(env);
  if (env.RIVALHUB_ALLOW_REMOTE_DB_WRITE) throw new Error("Mirror source does not accept remote-write authority.");
  return buildProductionEnvironment(env, { requiresWriteAuthorization: false }).DATABASE_URL!;
}

export function targetEnvironment(env: NodeJS.ProcessEnv = process.env) {
  assertRefreshRunner(env);
  if (env.RIVALHUB_PREVIEW_RESET_CONFIRM !== STAGING_PROJECT_REF) throw new Error("Explicit dev mirror reset confirmation required.");
  const databaseUrl = buildStagingEnvironment(env, { requiresWriteAuthorization: true }).DATABASE_URL!;
  const secretKey = env.RIVALHUB_PREVIEW_DEV_SECRET_KEY;
  if (!secretKey) throw new Error("Mirror dev Auth credential must be provisioned first.");
  return {
    databaseUrl,
    secretKey,
    applyCurrentMigrations: env.RIVALHUB_PREVIEW_APPLY_CURRENT_MIGRATIONS === "true",
    supabaseUrl: `https://${STAGING_PROJECT_REF}.supabase.co`,
  };
}

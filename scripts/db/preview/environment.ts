import { buildProductionEnvironment } from "../production-environment";
import { buildStagingEnvironment, STAGING_PROJECT_REF } from "../staging-environment";

export function assertRefreshRunner(env: NodeJS.ProcessEnv = process.env): void {
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_REPOSITORY !== "Starfie1d1272/RivalHub"
    || env.GITHUB_REF !== "refs/heads/main" || env.GITHUB_WORKFLOW !== "Refresh Preview Data"
    || !["schedule", "workflow_dispatch", "workflow_run"].includes(env.GITHUB_EVENT_NAME ?? "")) {
    throw new Error("Mirror refresh only runs from the protected main workflow.");
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
  const personaPassword = env.RIVALHUB_PREVIEW_PERSONA_PASSWORD;
  const readOnlyPassword = env.RIVALHUB_PREVIEW_RO_PASSWORD;
  if (!secretKey || !personaPassword || personaPassword.length < 24 || !readOnlyPassword || readOnlyPassword.length < 32) {
    throw new Error("Mirror dev Auth, persona and read-only role credentials must be provisioned first.");
  }
  return { databaseUrl, secretKey, personaPassword, readOnlyPassword, supabaseUrl: `https://${STAGING_PROJECT_REF}.supabase.co` };
}

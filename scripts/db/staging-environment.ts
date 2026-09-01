import {
  assertProtectedRemoteDatabaseUrl,
  buildProtectedRemoteEnvironment,
  type Environment,
  type ProtectedRemoteDatabaseConfig,
} from "./remote-environment";

const STAGING_PROJECT_REF = "cueazphyskstwdhnzsxx";
const stagingConfig: ProtectedRemoteDatabaseConfig = {
  target: "staging",
  projectRef: STAGING_PROJECT_REF,
  poolerHost: "aws-0-ap-northeast-1.pooler.supabase.com",
  poolerPort: "6543",
  requiresPgbouncer: true,
  passwordKey: "RIVALHUB_STAGING_DB_PASSWORD",
  projectConfirmationKey: "RIVALHUB_STAGING_PROJECT_CONFIRM",
  databaseUrlKey: "RIVALHUB_STAGING_DATABASE_URL",
  requireExplicitTarget: false,
};

export { STAGING_PROJECT_REF };

export function buildStagingEnvironment(
  env: Environment = process.env,
  options: { requiresWriteAuthorization: boolean },
): NodeJS.ProcessEnv {
  return buildProtectedRemoteEnvironment(env, stagingConfig, options);
}

export function assertStagingDatabaseUrl(value: string | undefined): string {
  return assertProtectedRemoteDatabaseUrl(value, stagingConfig);
}

import { assertLocalDatabaseUrl } from "./local-environment";
import { runCanonicalMigrations } from "./canonical-migrate";

/** Replay the active Drizzle chain against a plain PostgreSQL database. */
export function replayActiveMigrationChain(
  configuredUrl: string,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
): void {
  const databaseUrl = assertLocalDatabaseUrl(configuredUrl, "RIVALHUB_LOCAL_DATABASE_URL");
  runCanonicalMigrations("drizzle.local.config.ts", {
    ...baseEnvironment,
    DATABASE_URL: databaseUrl,
    RIVALHUB_LOCAL_DATABASE_URL: databaseUrl,
    RIVALHUB_DB_TARGET: "local",
  });
}

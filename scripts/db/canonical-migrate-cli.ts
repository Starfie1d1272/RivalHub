import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { postgresConnection } from "../../src/db/postgres-connection";
import { migrateCanonicalDatabase } from "./canonical-migrate";

/** Protected wrappers validate the target before invoking this child process. */
async function main(): Promise<void> {
  const [configPath, migrationsFolder] = process.argv.slice(2);
  if (!configPath || !migrationsFolder) throw new Error("Canonical migration config and folder are required.");
  const { default: config } = await import(pathToFileURL(resolve(configPath)).href);
  if (config?.dialect !== "postgresql" || typeof config?.dbCredentials?.url !== "string") {
    throw new Error("Canonical migration requires a PostgreSQL URL config.");
  }
  const pool = new Pool({ ...postgresConnection(config.dbCredentials.url), max: 1 });
  try {
    await migrateCanonicalDatabase(drizzle(pool), resolve(migrationsFolder));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Canonical migration failed.");
  process.exitCode = 1;
});

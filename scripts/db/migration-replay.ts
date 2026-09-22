import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { assertLocalDatabaseUrl } from "./local-environment";

const projectRoot = resolve(process.cwd());
const binSuffix = process.platform === "win32" ? ".cmd" : "";
const drizzleBin = resolve(projectRoot, `node_modules/.bin/drizzle-kit${binSuffix}`);

/** Replay the active Drizzle chain against a plain PostgreSQL database. */
export function replayActiveMigrationChain(
  configuredUrl: string,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
): void {
  const databaseUrl = assertLocalDatabaseUrl(configuredUrl, "RIVALHUB_LOCAL_DATABASE_URL");
  const result = spawnSync(
    drizzleBin,
    ["migrate", "--config=drizzle.local.config.ts"],
    {
      cwd: projectRoot,
      env: {
        ...baseEnvironment,
        DATABASE_URL: databaseUrl,
        RIVALHUB_LOCAL_DATABASE_URL: databaseUrl,
        RIVALHUB_DB_TARGET: "local",
      },
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`active migration replay 被信号 ${result.signal} 终止。`);
  if (result.status !== 0) {
    throw new Error(`active migration replay 失败（exit ${result.status ?? "unknown"}）。`);
  }
}

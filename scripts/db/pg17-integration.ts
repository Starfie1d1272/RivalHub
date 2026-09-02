import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { assertLocalDatabaseUrl } from "./local-environment";
import { preparePg17Database } from "./prepare-pg17";

const projectRoot = resolve(process.cwd());
const binSuffix = process.platform === "win32" ? ".cmd" : "";
const tsxBin = resolve(projectRoot, `node_modules/.bin/tsx${binSuffix}`);

async function main(): Promise<void> {
  const databaseUrl = assertLocalDatabaseUrl(
    process.env.RIVALHUB_LOCAL_DATABASE_URL ?? process.env.DATABASE_URL,
    "RIVALHUB_LOCAL_DATABASE_URL",
  );
  await preparePg17Database(databaseUrl);

  const result = spawnSync(tsxBin, ["scripts/db/integration-runner.ts"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      RIVALHUB_LOCAL_DATABASE_URL: databaseUrl,
      RIVALHUB_DB_TARGET: "local",
      RIVALHUB_TIMING: "1",
    },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`PG17 integration 被信号 ${result.signal} 终止。`);
  if ((result.status ?? 1) !== 0) {
    throw new Error(`PG17 integration 失败（exit ${result.status ?? "unknown"}）。`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

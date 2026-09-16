import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { assertLocalDatabaseUrl } from "./local-environment";
import { assertLocalContainerAccess } from "./local-container-guard";
import { replayActiveMigrationChain } from "./migration-replay";
import { preparePg17Database } from "./prepare-pg17";

const projectRoot = resolve(process.cwd());
const binSuffix = process.platform === "win32" ? ".cmd" : "";
const tsxBin = resolve(projectRoot, `node_modules/.bin/tsx${binSuffix}`);

/** Run the same PG17 preparation and active migration replay used by release CI. */
async function main(): Promise<void> {
  assertLocalContainerAccess("pnpm db:release-rehearsal");
  const databaseUrl = assertLocalDatabaseUrl(
    process.env.RIVALHUB_LOCAL_DATABASE_URL ?? process.env.DATABASE_URL,
    "RIVALHUB_LOCAL_DATABASE_URL",
  );
  const startedAt = Date.now();
  await preparePg17Database(databaseUrl);
  reportTiming("PG17 ready", startedAt);

  const replayStartedAt = Date.now();
  replayActiveMigrationChain(databaseUrl, process.env);
  reportTiming("PG17 active migration replay", replayStartedAt);

  runVerification("PG17 migration verification", ["scripts/db/verify-migrations.ts"], databaseUrl);
}

function runVerification(label: string, args: readonly string[], databaseUrl: string): void {
  const startedAt = Date.now();
  const result = spawnSync(tsxBin, [...args], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      RIVALHUB_LOCAL_DATABASE_URL: databaseUrl,
      RIVALHUB_DB_TARGET: "local",
    },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${label} 被信号 ${result.signal} 终止。`);
  if (result.status !== 0) throw new Error(`${label} 失败（exit ${result.status ?? "unknown"}）。`);
  reportTiming(label, startedAt);
}

function reportTiming(label: string, startedAt: number): void {
  if (process.env.RIVALHUB_TIMING === "1") console.log(`timing ${label}: ${Date.now() - startedAt}ms`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

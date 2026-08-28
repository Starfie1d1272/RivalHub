import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildStagingEnvironment } from "./staging-environment";

const projectRoot = resolve(process.cwd());
const binSuffix = process.platform === "win32" ? ".cmd" : "";
const drizzleBin = resolve(projectRoot, `node_modules/.bin/drizzle-kit${binSuffix}`);
const tsxBin = resolve(projectRoot, `node_modules/.bin/tsx${binSuffix}`);
const command = process.argv[2];

try {
  switch (command) {
    case "migrate":
      migrateStagingDatabase();
      break;
    case "verify":
      verifyStagingDatabase();
      break;
    default:
      throw new Error("未知命令。可用命令：migrate | verify");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function migrateStagingDatabase(): void {
  const stagingEnv = buildStagingEnvironment(stagingProcessEnvironment(), { requiresWriteAuthorization: true });

  // 不启动、不重置、不 seed Local Supabase；它必须已由操作者启动，并先通过同一 active chain。
  run(tsxBin, ["scripts/db/local.ts", "migrate"]);
  run(tsxBin, ["scripts/db/local.ts", "verify-migrations"]);

  run(drizzleBin, ["migrate", "--config=drizzle.staging.config.ts"], { env: stagingEnv });
  run(tsxBin, ["scripts/db/verify-migrations.ts"], { env: stagingEnv });
}

function verifyStagingDatabase(): void {
  const stagingEnv = buildStagingEnvironment(stagingProcessEnvironment(), { requiresWriteAuthorization: false });
  run(tsxBin, ["scripts/db/verify-migrations.ts"], { env: stagingEnv });
}

/**
 * `.env.local` is deliberately ignored by Git. Only its explicitly named
 * staging password is read here; production URLs and other local app settings
 * never become migration inputs.
 */
function stagingProcessEnvironment(): NodeJS.ProcessEnv {
  if (process.env.RIVALHUB_STAGING_DB_PASSWORD?.trim()) return process.env;
  try {
    const line = readFileSync(resolve(projectRoot, ".env.local"), "utf8")
      .split(/\r?\n/)
      .find((value) => value.startsWith("RIVALHUB_STAGING_DB_PASSWORD="));
    const password = line?.slice("RIVALHUB_STAGING_DB_PASSWORD=".length).trim();
    return password ? { ...process.env, RIVALHUB_STAGING_DB_PASSWORD: password } : process.env;
  } catch {
    return process.env;
  }
}

function run(
  executable: string,
  args: readonly string[],
  options: Pick<SpawnSyncOptions, "env"> = {},
): void {
  const result = spawnSync(executable, [...args], {
    cwd: projectRoot,
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`命令被信号 ${result.signal} 终止。`);
  if (result.status !== 0) {
    throw new Error(`命令执行失败（exit ${result.status ?? "unknown"}）。`);
  }
}

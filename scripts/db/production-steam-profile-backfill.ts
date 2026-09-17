import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { buildProductionEnvironment } from "./production-environment";

const projectRoot = resolve(process.cwd());
const executable = resolve(projectRoot, `node_modules/.bin/tsx${process.platform === "win32" ? ".cmd" : ""}`);
const apply = process.argv.includes("--apply");

try {
  const environment = buildProductionEnvironment(process.env, { requiresWriteAuthorization: apply });
  const result = spawnSync(executable, ["scripts/db/run-server-cli.ts", "scripts/db/steam-profile-backfill.ts", ...process.argv.slice(2)], {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...environment,
      RIVALHUB_PROTECTED_WRITE_TARGET: "production",
    },
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Steam profile backfill 被信号 ${result.signal} 终止。`);
  if (result.status !== 0) throw new Error(`Steam profile backfill 失败（exit ${result.status ?? "unknown"}）。`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

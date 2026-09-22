import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { buildProductionEnvironment } from "./production-environment";
import { buildProductionBackfillInvocation } from "./production-steam-profile-backfill-arguments";

const projectRoot = resolve(process.cwd());
const executable = resolve(projectRoot, `node_modules/.bin/tsx${process.platform === "win32" ? ".cmd" : ""}`);
const invocation = buildProductionBackfillInvocation(process.argv.slice(2));

try {
  const environment = buildProductionEnvironment(process.env, { requiresWriteAuthorization: invocation.apply });
  const result = spawnSync(executable, invocation.args, {
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

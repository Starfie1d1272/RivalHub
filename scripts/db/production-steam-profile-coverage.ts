import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { buildProductionEnvironment } from "./production-environment";

const projectRoot = resolve(process.cwd());
const executable = resolve(projectRoot, `node_modules/.bin/tsx${process.platform === "win32" ? ".cmd" : ""}`);

try {
  const environment = buildProductionEnvironment(process.env, { requiresWriteAuthorization: false });
  const result = spawnSync(executable, ["scripts/db/steam-profile-coverage.ts"], {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...environment,
      RIVALHUB_PROTECTED_READ_ONLY_TARGET: "production",
    },
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Steam profile coverage verify 被信号 ${result.signal} 终止。`);
  if (result.status !== 0) throw new Error(`Steam profile coverage verify 失败（exit ${result.status ?? "unknown"}）。`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

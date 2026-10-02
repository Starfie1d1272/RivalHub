import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { buildProductionEnvironment } from "./production-environment";

try {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args[0] !== "backfill" && args[0] !== "coverage") throw new Error("需要 backfill 或 coverage 子命令。");
  const apply = args[0] === "backfill" && args.includes("--apply");
  const environment = buildProductionEnvironment(process.env, { requiresWriteAuthorization: apply });
  const projectRoot = resolve(process.cwd());
  const executable = resolve(projectRoot, `node_modules/.bin/tsx${process.platform === "win32" ? ".cmd" : ""}`);
  const result = spawnSync(executable, ["scripts/db/run-server-cli.ts", "scripts/db/stats-projections.ts", ...args], {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...environment,
      RIVALHUB_PROTECTED_WRITE_TARGET: apply ? "production" : undefined,
      RIVALHUB_PROTECTED_READ_ONLY_TARGET: apply ? undefined : "production",
    },
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`统计投影工具被信号 ${result.signal} 终止。`);
  if (result.status !== 0) throw new Error(`统计投影工具失败（exit ${result.status ?? "unknown"}）。`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

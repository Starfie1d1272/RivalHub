import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { buildProductionAuthConsistencyEnvironment } from "./production-environment";

const projectRoot = resolve(process.cwd());
const executable = resolve(projectRoot, `node_modules/.bin/tsx${process.platform === "win32" ? ".cmd" : ""}`);

try {
  const requiresWriteAuthorization = process.argv.includes("--apply");
  const environment = buildProductionAuthConsistencyEnvironment(process.env, { requiresWriteAuthorization });
  const result = spawnSync(executable, ["scripts/db/auth-consistency-audit.ts", ...process.argv.slice(2)], {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...environment,
      NODE_OPTIONS: [environment.NODE_OPTIONS, "--conditions=react-server"].filter(Boolean).join(" "),
    },
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Auth consistency audit 被信号 ${result.signal} 终止。`);
  if (result.status !== 0) throw new Error(`Auth consistency audit 失败（exit ${result.status ?? "unknown"}）。`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

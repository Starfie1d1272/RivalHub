import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { buildVercelProductionVerificationEnvironment } from "./db/production-environment";
import { assertProductionReleaseBuild } from "./release/production-deployment";

const projectRoot = resolve(process.cwd());
const binSuffix = process.platform === "win32" ? ".cmd" : "";

try {
  if (process.env.VERCEL_ENV === "production") {
    // Production is release-only. If an unexpected production build reaches
    // Vercel, it must carry the release workflow's markers or fail closed.
    assertProductionReleaseBuild(process.env);
    const productionEnvironment = buildVercelProductionVerificationEnvironment(process.env);
    run(resolve(projectRoot, `node_modules/.bin/tsx${binSuffix}`), ["scripts/db/verify-migrations.ts"], productionEnvironment);
  }
  run(resolve(projectRoot, `node_modules/.bin/next${binSuffix}`), ["build"], process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function run(executable: string, args: readonly string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(executable, [...args], { cwd: projectRoot, stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Vercel build 被信号 ${result.signal} 终止。`);
  if (result.status !== 0) throw new Error(`Vercel build gate 失败（exit ${result.status ?? "unknown"}）。`);
}

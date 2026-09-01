import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { buildProductionEnvironment } from "./production-environment";
import { runProtectedRemoteCommand } from "./remote";

const projectRoot = resolve(process.cwd());

try {
  runProtectedRemoteCommand(process.argv[2], {
    drizzleConfig: "drizzle.production.config.ts",
    buildEnvironment: (options) => buildProductionEnvironment(productionProcessEnvironment(), options),
    beforeMigrate: (environment) => {
      // runProtectedRemoteCommand is synchronous, so the preflight is invoked
      // by the separate synchronous child below to keep the write ordering exact.
      const result = spawnSync(
        resolve(projectRoot, `node_modules/.bin/tsx${process.platform === "win32" ? ".cmd" : ""}`),
        ["scripts/db/production-preflight.ts"],
        { cwd: projectRoot, stdio: "inherit", env: environment },
      );
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error("Production migration preflight 失败；未执行远程写入。");
    },
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function productionProcessEnvironment(): NodeJS.ProcessEnv {
  if (process.env.RIVALHUB_PRODUCTION_DB_PASSWORD?.trim()) return process.env;
  try {
    const line = readFileSync(resolve(projectRoot, ".env.local"), "utf8").split(/\r?\n/)
      .find((value) => value.startsWith("RIVALHUB_PRODUCTION_DB_PASSWORD="));
    const password = line?.slice("RIVALHUB_PRODUCTION_DB_PASSWORD=".length).trim();
    return password ? { ...process.env, RIVALHUB_PRODUCTION_DB_PASSWORD: password } : process.env;
  } catch {
    return process.env;
  }
}

import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { buildProductionEnvironment } from "./production-environment";
import { runProtectedRemoteCommand } from "./remote";

const projectRoot = resolve(process.cwd());

try {
  runProtectedRemoteCommand(process.argv[2], {
    drizzleConfig: "drizzle.production.config.ts",
    buildEnvironment: (options) => buildProductionEnvironment(process.env, options),
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

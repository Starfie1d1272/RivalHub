import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { resolve } from "node:path";

interface ProtectedRemoteMigrationTarget {
  drizzleConfig: string;
  buildEnvironment: (options: { requiresWriteAuthorization: boolean }) => NodeJS.ProcessEnv;
  beforeMigrate?: (environment: NodeJS.ProcessEnv) => void;
}

const projectRoot = resolve(process.cwd());
const binSuffix = process.platform === "win32" ? ".cmd" : "";
const drizzleBin = resolve(projectRoot, `node_modules/.bin/drizzle-kit${binSuffix}`);
const tsxBin = resolve(projectRoot, `node_modules/.bin/tsx${binSuffix}`);

export function runProtectedRemoteCommand(
  command: string | undefined,
  target: ProtectedRemoteMigrationTarget,
): void {
  switch (command) {
    case "migrate": {
      const environment = target.buildEnvironment({ requiresWriteAuthorization: true });
      // The active chain must parse and replay in Local PostgreSQL before any
      // remote write. This intentionally does not seed, reset or db:push.
      run(drizzleBin, ["check"]);
      run(tsxBin, ["scripts/db/local.ts", "migrate"]);
      run(tsxBin, ["scripts/db/local.ts", "verify-migrations"]);
      target.beforeMigrate?.(environment);
      run(drizzleBin, ["migrate", `--config=${target.drizzleConfig}`], { env: environment });
      run(tsxBin, ["scripts/db/verify-migrations.ts"], { env: environment });
      return;
    }
    case "verify": {
      const environment = target.buildEnvironment({ requiresWriteAuthorization: false });
      run(tsxBin, ["scripts/db/verify-migrations.ts"], { env: environment });
      return;
    }
    default:
      throw new Error("未知命令。可用命令：migrate | verify");
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

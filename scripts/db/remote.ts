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
const RELEASE_MIGRATION_REHEARSAL_ENV = "RIVALHUB_RELEASE_MIGRATION_REHEARSAL";
const RELEASE_MIGRATION_REHEARSAL_MODE = "pg17";

/**
 * Release migration rehearsal is owned by the preceding plain PostgreSQL 17
 * job. The marker is intentionally accepted only from that protected Release
 * context; direct/manual production migration keeps its self-contained local
 * replay safety path.
 */
export function shouldUseExternalReleaseMigrationRehearsal(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const mode = env[RELEASE_MIGRATION_REHEARSAL_ENV];
  if (!mode) return false;
  if (mode !== RELEASE_MIGRATION_REHEARSAL_MODE) {
    throw new Error(`${RELEASE_MIGRATION_REHEARSAL_ENV} 只支持 ${RELEASE_MIGRATION_REHEARSAL_MODE}。`);
  }

  const isProtectedRelease =
    env.GITHUB_ACTIONS === "true" &&
    env.GITHUB_WORKFLOW === "Release" &&
    (env.GITHUB_EVENT_NAME === "push" || env.GITHUB_EVENT_NAME === "workflow_dispatch") &&
    env.RIVALHUB_DB_TARGET === "production" &&
    env.RIVALHUB_ALLOW_REMOTE_DB_WRITE === "production" &&
    env.RELEASE_TAG?.startsWith("v") === true &&
    Boolean(env.RELEASE_SHA) &&
    env.RIVALHUB_RELEASE_SHA === env.RELEASE_SHA;

  if (!isProtectedRelease) {
    throw new Error(
      `${RELEASE_MIGRATION_REHEARSAL_ENV} 只允许由 protected Release production migration 提供。`,
    );
  }
  return true;
}

export function runProtectedRemoteCommand(
  command: string | undefined,
  target: ProtectedRemoteMigrationTarget,
): void {
  switch (command) {
    case "migrate": {
      const usesExternalRehearsal = shouldUseExternalReleaseMigrationRehearsal();
      const environment = target.buildEnvironment({ requiresWriteAuthorization: true });
      // The active chain must parse before any remote write. Direct/manual
      // migration also replays it in Local PostgreSQL; protected Release has
      // already completed the same active-chain replay in its PG17 job.
      run(drizzleBin, ["check"]);
      if (usesExternalRehearsal) {
        console.log("已使用成功的 protected PG17 migration rehearsal；跳过 legacy Local PostgreSQL replay。\n");
      } else {
        // This intentionally does not seed, reset or db:push.
        run(tsxBin, ["scripts/db/local.ts", "migrate"]);
        run(tsxBin, ["scripts/db/local.ts", "verify-migrations"]);
      }
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

import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildLocalAppEnvironment,
  parseLocalDatabaseStatus,
  parseLocalSupabaseStatus,
  type LocalDatabaseStatus,
  type LocalSupabaseStatus,
} from "./local-environment";
import { acquireLocalVerificationLock } from "./local-lock";

const PROJECT_ID = "rivalhub";
const DOCKER_NETWORK = "rivalhub-local";
const projectRoot = resolve(process.cwd());
const binSuffix = process.platform === "win32" ? ".cmd" : "";
const supabaseBin = resolve(projectRoot, `node_modules/.bin/supabase${binSuffix}`);
const drizzleBin = resolve(projectRoot, `node_modules/.bin/drizzle-kit${binSuffix}`);
const tsxBin = resolve(projectRoot, `node_modules/.bin/tsx${binSuffix}`);
const nextBin = resolve(projectRoot, `node_modules/.bin/next${binSuffix}`);
const playwrightBin = resolve(projectRoot, `node_modules/.bin/playwright${binSuffix}`);
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
// Keep only the services exercised by Auth, Storage, PostgREST and browser E2E.
// These names are the Supabase CLI's current --exclude values.
const MINIMAL_SUPABASE_EXCLUDES =
  "realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";
const LOCKED_COMMANDS = new Set([
  "start",
  "start-db",
  "start-services",
  "stop",
  "migrate",
  "seed",
  "verify",
  "verify-db",
  "verify-supabase",
  "verify-migrations",
  "test-integration",
  "test-e2e",
  "verify-local",
  "bootstrap",
  "bootstrap-db",
  "bootstrap-services",
  "reset",
]);

const command = process.argv[2];
let releaseLocalLock: (() => void) | undefined;

try {
  if (command && LOCKED_COMMANDS.has(command)) {
    releaseLocalLock = acquireLocalVerificationLock(command);
  }
  switch (command) {
    case "start":
      startLocalStack();
      break;
    case "start-services":
      startLocalServices();
      break;
    case "start-db":
      startLocalDatabase();
      break;
    case "status":
      printStatus(readLocalStatus());
      break;
    case "migrate":
      migrateLocalDatabase();
      break;
    case "seed":
      seedLocalDatabase();
      break;
    case "verify":
      verifyLocalStack();
      break;
    case "verify-db":
      verifyDatabase();
      break;
    case "verify-supabase":
      verifySupabaseServices();
      break;
    case "verify-migrations":
      verifyLocalMigrations();
      break;
    case "test-integration":
      runLocalIntegrationSuite(process.argv.slice(3));
      break;
    case "test-e2e":
      runLocalE2E(process.argv.slice(3));
      break;
    case "verify-local":
      verifyLocalWorkflow();
      break;
    case "bootstrap":
      startLocalStack();
      migrateLocalDatabase();
      seedLocalDatabase();
      verifyLocalStack();
      break;
    case "bootstrap-services":
      ensureLocalServices();
      migrateLocalDatabase();
      seedLocalDatabase();
      break;
    case "bootstrap-db":
      ensureLocalDatabase();
      migrateLocalDatabase();
      seedLocalDatabase();
      break;
    case "reset":
      resetLocalDatabase();
      break;
    case "stop":
      run(supabaseBin, ["stop", "--project-id", PROJECT_ID], {
        env: sanitizedEnvironment(),
      });
      break;
    case "studio": {
      const status = readLocalStatus();
      console.log(status.studioUrl ?? "http://127.0.0.1:54323");
      break;
    }
    case "dev":
      runLocalApp();
      break;
    case "build":
      runLocalBuild();
      break;
    default:
      throw new Error(
        "未知命令。可用命令：start | start-db | start-services | status | migrate | seed | verify | verify-db | verify-supabase | verify-migrations | test-integration | test-e2e | verify-local | bootstrap | bootstrap-db | bootstrap-services | reset | stop | studio | dev | build",
      );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  releaseLocalLock?.();
}

function startLocalDatabase(): void {
  ensureDockerReady();
  ensureLoopbackDockerNetwork();
  runQuiet(
    supabaseBin,
    ["db", "start", "--network-id", DOCKER_NETWORK, "--yes"],
    sanitizedEnvironment(),
  );
  printDatabaseStatus(readLocalDatabaseStatus());
}

function startLocalStack(): void {
  ensureDockerReady();
  ensureLoopbackDockerNetwork();
  runQuiet(
    supabaseBin,
    ["start", "--network-id", DOCKER_NETWORK, "--yes"],
    sanitizedEnvironment(),
  );
  printStatus(readLocalStatus());
}

function startLocalServices(): void {
  ensureDockerReady();
  ensureLoopbackDockerNetwork();
  runQuiet(
    supabaseBin,
    ["start", "--exclude", MINIMAL_SUPABASE_EXCLUDES, "--network-id", DOCKER_NETWORK, "--yes"],
    sanitizedEnvironment(),
  );
  printStatus(readLocalStatus());
}

function migrateLocalDatabase(): void {
  const status = readLocalDatabaseStatus();
  run(
    drizzleBin,
    ["migrate", "--config=drizzle.local.config.ts"],
    {
      env: {
        ...sanitizedEnvironment(),
        RIVALHUB_LOCAL_DATABASE_URL: status.databaseUrl,
      },
    },
  );
}

function seedLocalDatabase(): void {
  const status = readLocalDatabaseStatus();
  const env = {
    ...sanitizedEnvironment(),
    DATABASE_URL: status.databaseUrl,
    RIVALHUB_LOCAL_DATABASE_URL: status.databaseUrl,
    RIVALHUB_DB_TARGET: "local",
  };

  run(tsxBin, ["scripts/seed.ts"], { env });
  run(tsxBin, ["scripts/db/seed-local-fixtures.ts"], { env });
}

function verifyLocalStack(): void {
  const status = readLocalStatus();
  run(tsxBin, ["scripts/db/verify-local.ts"], {
    env: buildLocalAppEnvironment(status, sanitizedEnvironment()),
  });
}

function verifyDatabase(): void {
  const status = readLocalDatabaseStatus();
  run(tsxBin, ["scripts/db/verify-db.ts"], {
    env: {
      ...sanitizedEnvironment(),
      DATABASE_URL: status.databaseUrl,
      RIVALHUB_DB_TARGET: "local",
    },
  });
}

function verifySupabaseServices(): void {
  const status = readLocalStatus();
  run(tsxBin, ["scripts/db/verify-supabase.ts"], {
    env: buildLocalAppEnvironment(status, sanitizedEnvironment()),
  });
}

function verifyLocalMigrations(): void {
  const status = readLocalDatabaseStatus();
  run(tsxBin, ["scripts/db/verify-migrations.ts"], {
    env: {
      ...sanitizedEnvironment(),
      DATABASE_URL: status.databaseUrl,
      RIVALHUB_DB_TARGET: "local",
    },
  });
}

function runLocalIntegrationSuite(args: readonly string[]): void {
  const status = readLocalDatabaseStatus();
  run(tsxBin, ["scripts/db/integration-runner.ts", ...normalizeCliArgs(args)], {
    env: {
      ...sanitizedEnvironment(),
      RIVALHUB_LOCAL_DATABASE_URL: status.databaseUrl,
      DATABASE_URL: status.databaseUrl,
    },
  });
}

function runLocalE2E(args: readonly string[]): void {
  const status = readLocalStatus();
  const env = buildLocalAppEnvironment(status, sanitizedEnvironment());
  let fixtureAttempted = false;
  try {
    fixtureAttempted = true;
    run(tsxBin, ["scripts/db/major-browser-fixture.ts", "create"], { env });
    run(playwrightBin, ["test", ...normalizeCliArgs(args)], { env });
  } finally {
    if (fixtureAttempted) {
      run(tsxBin, ["scripts/db/major-browser-fixture.ts", "cleanup"], { env });
      rmSync(resolve(projectRoot, ".agent-tmp", "major-browser-credentials.json"), { force: true });
    }
  }
}

function verifyLocalWorkflow(): void {
  ensureLocalServices();
  migrateLocalDatabase();
  seedLocalDatabase();
  verifyLocalStack();
  run(pnpmBin, ["run", "verify"], { env: sanitizedEnvironment() });
  runLocalIntegrationSuite([]);
  runLocalE2E([]);
}

function ensureLocalServices(): void {
  try {
    readLocalStatus();
  } catch {
    startLocalServices();
  }
}

function ensureLocalDatabase(): void {
  try {
    readLocalDatabaseStatus();
  } catch {
    startLocalDatabase();
  }
}

function normalizeCliArgs(args: readonly string[]): string[] {
  return args.filter((arg) => arg !== "--");
}

function resetLocalDatabase(): void {
  readLocalStatus();
  run(
    supabaseBin,
    [
      "db",
      "reset",
      "--local",
      "--no-seed",
      "--network-id",
      DOCKER_NETWORK,
      "--yes",
    ],
    { env: sanitizedEnvironment() },
  );
  migrateLocalDatabase();
  seedLocalDatabase();
  verifyLocalStack();
}

function runLocalApp(): void {
  const status = readLocalStatus();
  const env = buildLocalAppEnvironment(status, sanitizedEnvironment());
  env.NODE_OPTIONS = [env.NODE_OPTIONS, "--dns-result-order=ipv4first"]
    .filter(Boolean)
    .join(" ");
  run(nextBin, ["dev"], { env });
}

function runLocalBuild(): void {
  const status = readLocalStatus();
  const local = buildLocalAppEnvironment(status, sanitizedEnvironment());
  const env: NodeJS.ProcessEnv = {
    ...local,
    NODE_ENV: "production",
    NODE_OPTIONS: [local.NODE_OPTIONS, "--dns-result-order=ipv4first"].filter(Boolean).join(" "),
  };
  run(nextBin, ["build"], { env });
}

function readLocalStatus(): LocalSupabaseStatus {
  const result = spawnSync(
    supabaseBin,
    ["status", "--output", "json"],
    {
      cwd: projectRoot,
      env: sanitizedEnvironment(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (result.error || result.status !== 0) {
    throw new Error(
      "Local Supabase service 未运行或状态不可读；请先执行 pnpm db:local:start-services。",
    );
  }
  return parseLocalSupabaseStatus(result.stdout);
}

function readLocalDatabaseStatus(): LocalDatabaseStatus {
  const result = spawnSync(
    supabaseBin,
    ["status", "--output", "json"],
    {
      cwd: projectRoot,
      env: sanitizedEnvironment(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (result.error || result.status !== 0) {
    throw new Error(
      "Local PostgreSQL 未运行或状态不可读；请先执行 pnpm db:local:start-db。",
    );
  }
  return parseLocalDatabaseStatus(result.stdout);
}

function ensureDockerReady(): void {
  const result = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    cwd: projectRoot,
    env: sanitizedEnvironment(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0 || !result.stdout.trim()) {
    throw new Error(
      "Docker-compatible runtime 未运行。请启动 Docker Desktop、OrbStack 或至少分配 8 GiB 的 Colima。",
    );
  }
}

function ensureLoopbackDockerNetwork(): void {
  const inspect = spawnSync(
    "docker",
    [
      "network",
      "inspect",
      "--format",
      '{{index .Options "com.docker.network.bridge.host_binding_ipv4"}}',
      DOCKER_NETWORK,
    ],
    {
      cwd: projectRoot,
      env: sanitizedEnvironment(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (inspect.status === 0) {
    if (inspect.stdout.trim() !== "127.0.0.1") {
      throw new Error(
        `Docker network ${DOCKER_NETWORK} 已存在但未限制到 127.0.0.1；拒绝启动。`,
      );
    }
    return;
  }

  run(
    "docker",
    [
      "network",
      "create",
      "--driver",
      "bridge",
      "--opt",
      "com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
      DOCKER_NETWORK,
    ],
    { env: sanitizedEnvironment() },
  );
}

function printStatus(status: LocalSupabaseStatus): void {
  const database = new URL(status.databaseUrl);
  console.log(
    [
      "Local Supabase ready:",
      `  Database: ${database.hostname}:${database.port}`,
      `  API: ${status.apiUrl}`,
      `  Studio: ${status.studioUrl ?? "disabled (minimal profile)"}`,
    ].join("\n"),
  );
}

function printDatabaseStatus(status: LocalDatabaseStatus): void {
  const database = new URL(status.databaseUrl);
  console.log(["Local PostgreSQL ready:", `  Database: ${database.hostname}:${database.port}`].join("\n"));
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

function runQuiet(
  executable: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): void {
  const result = spawnSync(executable, [...args], {
    cwd: projectRoot,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`命令被信号 ${result.signal} 终止。`);
  if (result.status !== 0) {
    const detail = result.stderr.trim().slice(0, 2000);
    throw new Error(
      `Local Supabase 启动失败（exit ${result.status ?? "unknown"}）${detail ? `：${detail}` : ""}`,
    );
  }
}

function sanitizedEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of [
    "DATABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_DB_PASSWORD",
    "SUPABASE_PROJECT_ID",
    "RIVALHUB_DB_TARGET",
    "RIVALHUB_DB_HOST_CONFIRM",
    "RIVALHUB_ALLOW_REMOTE_DB_WRITE",
    "RIVALHUB_LOCAL_DATABASE_URL",
  ]) {
    delete env[key];
  }
  return env;
}

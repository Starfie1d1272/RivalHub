import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { resolve } from "node:path";
import {
  buildLocalAppEnvironment,
  parseLocalSupabaseStatus,
  type LocalSupabaseStatus,
} from "./local-environment";

const PROJECT_ID = "rivalhub";
const DOCKER_NETWORK = "rivalhub-local";
const projectRoot = resolve(process.cwd());
const binSuffix = process.platform === "win32" ? ".cmd" : "";
const supabaseBin = resolve(projectRoot, `node_modules/.bin/supabase${binSuffix}`);
const drizzleBin = resolve(projectRoot, `node_modules/.bin/drizzle-kit${binSuffix}`);
const tsxBin = resolve(projectRoot, `node_modules/.bin/tsx${binSuffix}`);
const nextBin = resolve(projectRoot, `node_modules/.bin/next${binSuffix}`);

const command = process.argv[2];

try {
  switch (command) {
    case "start":
      startLocalStack();
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
    case "verify-migrations":
      verifyLocalMigrations();
      break;
    case "test-major-start":
      testMajorStart();
      break;
    case "test-major-golden":
      testMajorStart();
      break;
    case "test-major-browser":
      runLocalBrowserFixture("create");
      break;
    case "cleanup-major-browser":
      runLocalBrowserFixture("cleanup");
      break;
    case "test-team-registration":
      runLocalIntegration("scripts/db/team-registration-integration.ts");
      break;
    case "test-competition-entry-migration":
      runLocalIntegration("scripts/db/competition-entry-migration-replay.ts");
      break;
    case "test-competitive-catalog-migration":
      runLocalIntegration("scripts/db/competitive-catalog-migration-replay.ts");
      break;
    case "test-competitive-catalog":
      runLocalIntegration("scripts/db/competitive-catalog-integration.ts");
      break;
    case "test-major-profile":
      runLocalIntegration("scripts/db/major-profile-integration.ts");
      break;
    case "test-major-prestart":
      runLocalIntegration("scripts/db/major-prestart-integration.ts");
      break;
    case "test-major-roster-safety":
      runLocalIntegration("scripts/db/major-roster-safety-integration.ts");
      break;
    case "test-major-result-recovery":
      runLocalIntegration("scripts/db/major-result-recovery-integration.ts");
      break;
    case "test-invite-concurrency":
      runLocalIntegration("scripts/db/invite-concurrency-integration.ts");
      break;
    case "test-discipline":
      runLocalIntegration("scripts/db/discipline-integration.ts");
      break;
    case "test-postevent":
      runLocalIntegration("scripts/db/postevent-integration.ts");
      break;
    case "test-season-governance":
      runLocalIntegration("scripts/db/season-governance-integration.ts");
      break;
    case "bootstrap":
      startLocalStack();
      migrateLocalDatabase();
      seedLocalDatabase();
      verifyLocalStack();
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
    default:
      throw new Error(
        "未知命令。可用命令：start | status | migrate | seed | verify | verify-migrations | test-major-start | test-major-golden | test-major-browser | cleanup-major-browser | test-team-registration | test-competition-entry-migration | test-competitive-catalog-migration | test-competitive-catalog | test-major-profile | test-major-prestart | test-major-roster-safety | test-major-result-recovery | test-invite-concurrency | test-discipline | test-postevent | test-season-governance | bootstrap | reset | stop | studio | dev",
      );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
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

function migrateLocalDatabase(): void {
  const status = readLocalStatus();
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
  const status = readLocalStatus();
  const env = {
    ...buildLocalAppEnvironment(status, sanitizedEnvironment()),
    RIVALHUB_ROOT_USERNAME:
      process.env.RIVALHUB_LOCAL_ROOT_USERNAME ?? "local-admin",
    RIVALHUB_ROOT_PASSWORD:
      process.env.RIVALHUB_LOCAL_ROOT_PASSWORD ?? "local-admin-password",
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

function verifyLocalMigrations(): void {
  const status = readLocalStatus();
  run(tsxBin, ["scripts/db/verify-migrations.ts"], {
    env: {
      ...sanitizedEnvironment(),
      DATABASE_URL: status.databaseUrl,
      RIVALHUB_DB_TARGET: "local",
    },
  });
}

function testMajorStart(): void {
  const status = readLocalStatus();
  run(tsxBin, ["scripts/db/major-start-integration.ts"], {
    env: {
      ...sanitizedEnvironment(),
      RIVALHUB_LOCAL_DATABASE_URL: status.databaseUrl,
    },
  });
}

function runLocalBrowserFixture(mode: "create" | "cleanup"): void {
  const status = readLocalStatus();
  run(tsxBin, ["scripts/db/major-browser-fixture.ts", mode], {
    env: buildLocalAppEnvironment(status, sanitizedEnvironment()),
  });
}

function runLocalIntegration(script: string): void {
  const status = readLocalStatus();
  run(tsxBin, [script], {
    env: {
      ...sanitizedEnvironment(),
      RIVALHUB_LOCAL_DATABASE_URL: status.databaseUrl,
      DATABASE_URL: status.databaseUrl,
    },
  });
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
      "Local Supabase 未运行或状态不可读；请先执行 pnpm db:local:start。",
    );
  }
  return parseLocalSupabaseStatus(result.stdout);
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
      `  Studio: ${status.studioUrl ?? "http://127.0.0.1:54323"}`,
    ].join("\n"),
  );
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
    "RIVALHUB_ROOT_USERNAME",
    "RIVALHUB_ROOT_PASSWORD",
  ]) {
    delete env[key];
  }
  return env;
}

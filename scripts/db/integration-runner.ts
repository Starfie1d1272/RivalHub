import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Client } from "pg";
import { assertLocalDatabaseUrl } from "./local-environment";

const projectRoot = resolve(process.cwd());
const binSuffix = process.platform === "win32" ? ".cmd" : "";
const drizzleBin = resolve(projectRoot, `node_modules/.bin/drizzle-kit${binSuffix}`);
const tsxBin = resolve(projectRoot, `node_modules/.bin/tsx${binSuffix}`);
const vitestBin = resolve(projectRoot, `node_modules/.bin/vitest${binSuffix}`);

type IsolatedDatabase = {
  name: string;
  url: string;
};

async function main(): Promise<void> {
  const configuredUrl = assertLocalDatabaseUrl(
    process.env.RIVALHUB_LOCAL_DATABASE_URL,
    "RIVALHUB_LOCAL_DATABASE_URL",
  );
  const workerCount = readWorkerCount(process.env.RIVALHUB_INTEGRATION_WORKERS);
  const runId = randomUUID().replaceAll("-", "").slice(0, 12);
  const baselineName = `rh355_baseline_${runId}`;
  const databases: IsolatedDatabase[] = [];
  const integrationStartedAt = Date.now();

  try {
    await timedAsync("baseline-create", () => createDatabaseFromTemplate(configuredUrl, baselineName));
    const baselineUrl = databaseUrl(configuredUrl, baselineName);
    databases.push({ name: baselineName, url: baselineUrl });
    const bootstrapStartedAt = Date.now();
    bootstrapDatabase(baselineUrl);
    reportTiming("integration-bootstrap", bootstrapStartedAt);

    const admin = await connectMaintenance(configuredUrl);
    const workerCloneStartedAt = Date.now();
    try {
      for (let index = 1; index <= workerCount; index += 1) {
        const name = `rh355_worker_${runId}_${index}`;
        await admin.query(`CREATE DATABASE ${identifier(name)} TEMPLATE ${identifier(baselineName)}`);
        databases.push({ name, url: databaseUrl(configuredUrl, name) });
      }
    } finally {
      await admin.end();
    }
    reportTiming("worker-clones", workerCloneStartedAt);

    const workerUrls = databases.slice(1).map((database) => database.url);
    console.log(
      `PostgreSQL integration isolation: cloned ${workerUrls.length} worker databases from a migrated/seeded template1 baseline.`,
    );

    const vitestStartedAt = Date.now();
    const result = spawnSync(
      vitestBin,
      ["run", "--config=vitest.integration.config.ts", ...normalizeArgs(process.argv.slice(2))],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          DATABASE_URL: configuredUrl,
          RIVALHUB_LOCAL_DATABASE_URL: configuredUrl,
          RIVALHUB_DB_TARGET: "local",
          RIVALHUB_INTEGRATION_DATABASES: JSON.stringify(workerUrls),
        },
        stdio: "inherit",
      },
    );
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`Vitest 被信号 ${result.signal} 终止。`);
    if ((result.status ?? 1) !== 0) {
      throw new Error(`真实 PostgreSQL integration 失败（exit ${result.status ?? "unknown"}）。`);
    }
    reportTiming("vitest", vitestStartedAt);
  } finally {
    await timedAsync("cleanup", () => dropDatabases(configuredUrl, databases.map((database) => database.name)));
    reportTiming("integration-total", integrationStartedAt);
  }
}

async function createDatabaseFromTemplate(configuredUrl: string, name: string): Promise<void> {
  const admin = await connectMaintenance(configuredUrl);
  try {
    await admin.query(`CREATE DATABASE ${identifier(name)} TEMPLATE template1`);
  } finally {
    await admin.end();
  }
}

function bootstrapDatabase(databaseUrlValue: string): void {
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrlValue,
    RIVALHUB_LOCAL_DATABASE_URL: databaseUrlValue,
    RIVALHUB_DB_TARGET: "local",
  };
  runCommand("migrate", drizzleBin, ["migrate", "--config=drizzle.local.config.ts"], env);
  runCommand("seed", tsxBin, ["scripts/seed.ts"], env);
  runCommand("fixtures", tsxBin, ["scripts/db/seed-local-fixtures.ts"], env);
  runCommand("verify-db", tsxBin, ["scripts/db/verify-db.ts"], env);
}

async function connectMaintenance(configuredUrl: string): Promise<Client> {
  const client = new Client({ connectionString: databaseUrl(configuredUrl, "postgres"), ssl: false });
  await client.connect();
  return client;
}

async function dropDatabases(configuredUrl: string, names: readonly string[]): Promise<void> {
  if (names.length === 0) return;
  const admin = await connectMaintenance(configuredUrl);
  try {
    for (const name of [...names].reverse()) {
      await admin.query(`DROP DATABASE IF EXISTS ${identifier(name)} WITH (FORCE)`);
    }
  } finally {
    await admin.end();
  }
}

function runCommand(label: string, executable: string, args: readonly string[], env: NodeJS.ProcessEnv): void {
  const startedAt = Date.now();
  try {
    const result = spawnSync(executable, [...args], {
      cwd: projectRoot,
      env,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`${executable} 被信号 ${result.signal} 终止。`);
    if (result.status !== 0) {
      throw new Error(`${executable} 执行失败（exit ${result.status ?? "unknown"}）。`);
    }
  } finally {
    reportTiming(label, startedAt);
  }
}

async function timedAsync<T>(label: string, operation: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    return await operation();
  } finally {
    reportTiming(label, startedAt);
  }
}

function reportTiming(label: string, startedAt: number): void {
  if (process.env.RIVALHUB_TIMING === "1") {
    console.log(`timing ${label}: ${Date.now() - startedAt}ms`);
  }
}

function readWorkerCount(value: string | undefined): number {
  const count = Number(value ?? "2");
  if (!Number.isInteger(count) || count < 1 || count > 4) {
    throw new Error("RIVALHUB_INTEGRATION_WORKERS 必须是 1 到 4 之间的整数。");
  }
  return count;
}

function databaseUrl(configuredUrl: string, name: string): string {
  const url = new URL(configuredUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizeArgs(args: readonly string[]): string[] {
  return args.filter((arg) => arg !== "--");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertLocalDatabaseUrl } from "./local-environment";
import { assertLocalContainerAccess } from "./local-container-guard";
import { preparePg17Database } from "./prepare-pg17";

const projectRoot = resolve(process.cwd());
const binSuffix = process.platform === "win32" ? ".cmd" : "";
const tsxBin = resolve(projectRoot, `node_modules/.bin/tsx${binSuffix}`);

async function main(): Promise<void> {
  assertLocalContainerAccess("pnpm test:integration:pg17");
  const databaseUrl = assertLocalDatabaseUrl(
    process.env.RIVALHUB_LOCAL_DATABASE_URL ?? process.env.DATABASE_URL,
    "RIVALHUB_LOCAL_DATABASE_URL",
  );
  await preparePg17Database(databaseUrl);

  const result = spawnSync(tsxBin, ["scripts/db/integration-runner.ts", ...integrationArgs()], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      RIVALHUB_LOCAL_DATABASE_URL: databaseUrl,
      RIVALHUB_DB_TARGET: "local",
      RIVALHUB_TIMING: "1",
    },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`PG17 integration 被信号 ${result.signal} 终止。`);
  if ((result.status ?? 1) !== 0) {
    throw new Error(`PG17 integration 失败（exit ${result.status ?? "unknown"}）。`);
  }
}

export function integrationArgs(args = process.argv.slice(2), env = process.env): string[] {
  const shard = env.RIVALHUB_INTEGRATION_SHARD;
  if (shard !== undefined && !["1/1", "1/2", "2/2"].includes(shard)) {
    throw new Error("RIVALHUB_INTEGRATION_SHARD 必须是 1/1、1/2 或 2/2；最多两个 PG 分片。");
  }
  const shardArgs = shard ? [`--shard=${shard}`] : [];
  const explicit = args.filter((arg) => arg !== "--");
  if (shard && explicit.some((arg) => arg === "--shard" || arg.startsWith("--shard="))) {
    throw new Error("PG 分片只能由 RIVALHUB_INTEGRATION_SHARD 配置，不能同时传入 --shard。");
  }
  if (explicit.length > 0) return [...explicit, ...shardArgs];
  const raw = env.RIVALHUB_INTEGRATION_SPECS?.trim();
  if (!raw || raw === "[]") return shardArgs;
  let specs: unknown;
  try {
    specs = JSON.parse(raw);
  } catch {
    throw new Error("RIVALHUB_INTEGRATION_SPECS 必须是 JSON 数组。");
  }
  if (!Array.isArray(specs) || specs.some((spec) => typeof spec !== "string" || !spec.trim())) {
    throw new Error("RIVALHUB_INTEGRATION_SPECS 必须是字符串数组。");
  }
  return [...specs, ...shardArgs];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

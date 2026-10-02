import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../src/db/schema";
import { backfillStatisticsProjections, inspectStatisticsProjectionCoverage } from "../../src/lib/stats/projection-backfill";
import { assertLocalDatabaseUrl } from "./local-environment";

export const STATS_PROJECTION_WRITE_CONFIRMATION = "I_UNDERSTAND_STATS_PROJECTION_WRITE";

export function parseStatsProjectionArguments(argv: readonly string[]) {
  const args = [...argv];
  while (args[0] === "--") args.shift();
  const mode = args.shift();
  if (mode !== "backfill" && mode !== "coverage") throw new Error("用法：stats-projections.ts backfill [--apply] [--limit N] | coverage");
  let apply = false;
  let limit: number | undefined;
  for (let index = 0; index < args.length; index++) {
    if (mode === "backfill" && args[index] === "--apply") { apply = true; continue; }
    if (mode === "backfill" && args[index] === "--limit") {
      limit = Number(args[++index]);
      if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("--limit 必须是正整数。");
      continue;
    }
    throw new Error(`无效的统计投影参数：${args[index]}`);
  }
  return { mode, apply, limit };
}

export function statsProjectionDatabaseTarget(apply: boolean, env: NodeJS.ProcessEnv = process.env) {
  const target = env.RIVALHUB_DB_TARGET;
  if (target === "local") return { target, databaseUrl: assertLocalDatabaseUrl(env.DATABASE_URL) };
  const protectedTarget = apply ? env.RIVALHUB_PROTECTED_WRITE_TARGET : env.RIVALHUB_PROTECTED_READ_ONLY_TARGET;
  if (target !== "production" || protectedTarget !== target) {
    throw new Error("统计投影工具只接受 local，或 protected production wrapper。");
  }
  if (apply && env.RIVALHUB_STATS_PROJECTION_WRITE_CONFIRM !== STATS_PROJECTION_WRITE_CONFIRMATION) {
    throw new Error(`需要显式设置 RIVALHUB_STATS_PROJECTION_WRITE_CONFIRM=${STATS_PROJECTION_WRITE_CONFIRMATION}。`);
  }
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL 未设置。");
  return { target, databaseUrl };
}

async function main() {
  const args = parseStatsProjectionArguments(process.argv.slice(2));
  const { target, databaseUrl } = statsProjectionDatabaseTarget(args.apply);
  const pool = new Pool({ connectionString: databaseUrl, ssl: target === "production" ? { rejectUnauthorized: false } : false, max: 1 });
  try {
    const database = drizzle(pool, { schema });
    if (args.mode === "coverage") {
      const report = await database.transaction(inspectStatisticsProjectionCoverage, { isolationLevel: "repeatable read", accessMode: "read only" });
      console.log(JSON.stringify({ target, mode: "read-only", ...report }, null, 2));
      if (!report.ready) throw new Error(`统计投影 coverage 未通过：missing=${report.missing}。旧 Production 保持不变。`);
    } else {
      const report = await backfillStatisticsProjections(database, args);
      console.log(JSON.stringify({ target, mode: args.apply ? "apply" : "dry-run", ...report }, null, 2));
    }
  } finally {
    await pool.end();
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}

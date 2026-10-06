import * as schema from "../../src/db/schema";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { postgresConnection } from "../../src/db/postgres-connection";
import { inspectCompetitiveProfileRepair, repairCompetitiveProfileMissingRows } from "../../src/lib/competitive/profile-repair";
import { assertLocalDatabaseUrl } from "./local-environment";

async function main() {
  const args = process.argv.slice(2).filter(arg => arg !== "--");
  if (args.length > 1 || (args.length === 1 && args[0] !== "--apply" && args[0] !== "--verify")) throw new Error("只接受 --apply / --verify，默认 dry-run。");
  const apply = args[0] === "--apply";
  const target = process.env.RIVALHUB_DB_TARGET;
  const marker = apply ? process.env.RIVALHUB_PROTECTED_WRITE_TARGET : process.env.RIVALHUB_PROTECTED_READ_ONLY_TARGET;
  if (target !== "local" && (target !== "production" || marker !== "production")) throw new Error("只允许 local 或 protected production wrapper。");
  const url = target === "local" ? assertLocalDatabaseUrl(process.env.DATABASE_URL) : process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 未设置。");
  const pool = new Pool({ ...postgresConnection(url), max: 1 });
  try {
    const database = drizzle(pool, { schema });
    const report = await database.transaction(tx => apply ? repairCompetitiveProfileMissingRows(tx) : inspectCompetitiveProfileRepair(tx), apply ? undefined : { isolationLevel: "repeatable read", accessMode: "read only" });
    console.log(JSON.stringify({ target, mode: args[0] ?? "dry-run", ...report }, null, 2));
    if (args[0] === "--verify" && report.missing !== 0) throw new Error("无歧义 missing rows 尚未归零。");
    if (apply && "after" in report && (report.after as Awaited<ReturnType<typeof inspectCompetitiveProfileRepair>>).missing !== 0) throw new Error("修复后 missing rows 尚未归零。");
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../src/db/schema";
import { postgresConnection } from "../../src/db/postgres-connection";
import { recordLegacyRetirementPreflight } from "../../src/lib/predictions/retirement-preflight";
import { assertLocalDatabaseUrl } from "./local-environment";
import { buildProductionEnvironment } from "./production-environment";
import { buildStagingEnvironment } from "./staging-environment";

async function main() {
  const target = process.env.RIVALHUB_DB_TARGET;
  const url = target === "local" ? assertLocalDatabaseUrl(process.env.RIVALHUB_LOCAL_DATABASE_URL, "RIVALHUB_LOCAL_DATABASE_URL") :
    target === "production" ? buildProductionEnvironment(process.env, { requiresWriteAuthorization: true }).DATABASE_URL :
    target === "staging" ? buildStagingEnvironment(process.env, { requiresWriteAuthorization: true }).DATABASE_URL : undefined;
  if (!url) throw new Error("Explicit local, staging or production target is required");
  const actorId = process.env.RIVALHUB_RETIREMENT_ACTOR ?? "";
  const reason = process.env.RIVALHUB_RETIREMENT_REASON ?? "";
  const pool = new Pool({ ...postgresConnection(url), max: 1 });
  try {
    const db = drizzle(pool, { schema });
    const result = await db.transaction(tx => recordLegacyRetirementPreflight(tx, { actorId, reason }));
    console.log(`Retirement snapshot recorded: ${result.marketCount} markets; digest ${result.snapshotDigest}`);
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Retirement preflight failed"); process.exitCode = 1; });

import { Pool } from "pg";
import { postgresConnection } from "../../src/db/postgres-connection";
import { assertProductionConfirmations, assertProductionDatabaseUrl } from "./production-environment";
import { assertStagingDatabaseUrl } from "./staging-environment";
import { assertHostedRealtimeTable } from "./realtime-policy";

async function main(): Promise<void> {
  const target = process.env.RIVALHUB_DB_TARGET;
  if (target === "production") assertProductionConfirmations(process.env);
  const url = target === "production" ? assertProductionDatabaseUrl(process.env.DATABASE_URL)
    : target === "staging" ? assertStagingDatabaseUrl(process.env.DATABASE_URL)
      : (() => { throw new Error("Realtime preflight requires hosted target"); })();
  const pool = new Pool({ ...postgresConnection(url), max: 1 });
  try { await assertHostedRealtimeTable(pool); console.log(`Hosted Realtime table ready (${target}).`); }
  finally { await pool.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Realtime preflight failed"); process.exit(1); });

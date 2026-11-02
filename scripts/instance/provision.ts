import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { postgresConnection } from "../../src/db/postgres-connection";
import { OFFICIAL_PREVIEW, OFFICIAL_PRODUCTION } from "../../src/lib/runtime/official-deployment-profile.mjs";
import { requireApplicationOrigin, requireSupabaseOrigin } from "../../src/lib/runtime/public-config";
import { migrateCanonicalDatabase } from "../db/canonical-migrate";
import { runScheduler } from "../db/scheduler";
import { verifyTeamLogoBucket } from "../db/verify-migrations";

/** Fresh-only installation; existing deployments must use an upgrade path. */
async function installFreshInstance(client: PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_lock(hashtext('rivalhub.instance.install'))");
  try {
    const result = await client.query(`SELECT to_regclass('drizzle.__drizzle_migrations') AS ledger,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S')) AS objects,
      to_regclass('auth.users') AS auth_users, to_regclass('storage.objects') AS storage_objects,
      to_regclass('storage.buckets') AS storage_buckets`);
    const state = result.rows[0];
    if (state.ledger || state.objects !== 0 || !state.auth_users || !state.storage_objects || !state.storage_buckets) throw Error("Fresh Supabase target required; adoption or retry after partial migration is not supported.");
    const existing = await client.query<{ users: boolean; objects: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM auth.users) AS users, EXISTS (SELECT 1 FROM storage.objects) AS objects",
    );
    if (existing.rows[0]?.users || existing.rows[0]?.objects) throw Error("Fresh Supabase target must not contain existing Auth users or Storage objects.");
    await migrateCanonicalDatabase(drizzle(client), 'drizzle/migrations');
    if (await verifyTeamLogoBucket(client) !== "verified") throw Error("Supabase Storage bucket table is unavailable; installation is incomplete.");
    const officialRule = await client.query<{ present: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM institution_email_domains WHERE domain=$1) AS present", ["smail.nju.edu.cn"],
    );
    if (officialRule.rows[0]?.present !== false) throw Error("Generic baseline unexpectedly contains official email trust.");
    console.log('Active migration chain installed; generic instance has no official-only email trust.');
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('rivalhub.instance.install'))");
  }
}

async function main() {
  const command = process.argv[2];
  if (!["install", "scheduler", "verify-scheduler"].includes(command ?? "")) throw Error("Usage: provision.ts install|scheduler|verify-scheduler");
  const api = new URL(requireSupabaseOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL));
  const app = requireApplicationOrigin();
  const db = new URL(process.env.DATABASE_URL ?? "");
  const ref = process.env.RIVALHUB_INSTANCE_PROJECT_REF;
  if (!ref || !/^[a-z]{20}$/.test(ref) || [OFFICIAL_PRODUCTION.projectRef, OFFICIAL_PREVIEW.projectRef].includes(ref)) throw Error("A non-official instance project ref is required.");
  if (api.hostname !== `${ref}.supabase.co` || !(db.hostname === `db.${ref}.supabase.co` || (db.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(db.username) === `postgres.${ref}`))) throw Error("Database and API must belong to the confirmed Supabase project.");
  if (process.env.RIVALHUB_INSTANCE_CONFIRM !== ref || app === OFFICIAL_PRODUCTION.origin) throw Error("Explicit instance project confirmation and a non-official origin are required.");
  if (command !== 'verify-scheduler' && process.env.RIVALHUB_INSTANCE_WRITE !== 'yes') throw Error("Set RIVALHUB_INSTANCE_WRITE=yes for this explicitly targeted operation.");
  // The runtime may use transaction pooling. Migration advisory locks and the
  // migration runner require one stable backend, so use the same project and
  // credential through the session pooler instead.
  if (db.hostname.endsWith('.pooler.supabase.com')) {
    if (!['5432', '6543'].includes(db.port)) throw Error('Expected a Supabase session or transaction pooler port.');
    db.port = '5432';
    db.searchParams.delete('pgbouncer');
  } else if (db.port && db.port !== '5432') {
    throw Error('Direct database provisioning requires port 5432.');
  }
  const pool = new Pool({ ...postgresConnection(db.toString()), max: 1 });
  try {
    if (command === 'install') {
      const client = await pool.connect();
      try {
        await installFreshInstance(client);
      } finally {
        client.release();
      }
    } else {
      await runScheduler(pool, command === 'scheduler' ? 'provision' : 'verify', {
        ...process.env, RIVALHUB_SCHEDULER_BASE_URL: app,
      });
    }
  } finally { await pool.end(); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Instance provisioning failed.'); process.exitCode = 1; });

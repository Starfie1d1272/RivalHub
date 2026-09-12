import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { createClient } from "@supabase/supabase-js";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { assertActiveChainPrefix, readExpectedMigrations } from "../production-preflight";
import { verifyForeignKeys } from "../recovery/verify";
import { targetEnvironment } from "./environment";
import { readSnapshot, type MirrorSnapshot } from "./snapshot";
import { quoteIdentifier } from "./policy";

const PERSONAS = ["player", "invited", "captain", "season-admin", "super-admin"] as const;

async function migrateToSource(client: PoolClient, snapshot: MirrorSnapshot): Promise<void> {
  const exists = await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS ledger");
  const actual = exists.rows[0].ledger ? (await client.query("SELECT hash, created_at::text AS when FROM drizzle.__drizzle_migrations ORDER BY created_at")).rows
    .map((row) => ({ hash: String(row.hash), when: Number(row.when) })) : [];
  assertActiveChainPrefix(actual, snapshot.migrations);
  const folder = mkdtempSync(join(tmpdir(), "rivalhub-preview-migrations-"));
  try {
    mkdirSync(join(folder, "meta"));
    const journal = JSON.parse(readFileSync("drizzle/migrations/meta/_journal.json", "utf8"));
    journal.entries = journal.entries.slice(0, snapshot.migrations.length);
    writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify(journal));
    for (const entry of readExpectedMigrations().slice(0, snapshot.migrations.length)) {
      copyFileSync(`drizzle/migrations/${entry.tag}.sql`, join(folder, `${entry.tag}.sql`));
    }
    await migrate(drizzle(client), { migrationsFolder: folder });
  } finally { rmSync(folder, { recursive: true, force: true }); }
}

export async function provisionReadOnlyRole(client: PoolClient, password: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{32,}$/.test(password)) throw new Error("Read-only credential must use the protected random token format.");
  await client.query(`DO $$ BEGIN CREATE ROLE rivalhub_preview_ro LOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  // Fixed role and restricted token alphabet; identifiers/password never originate in PR input.
  await client.query(`ALTER ROLE rivalhub_preview_ro WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
  await client.query(`REVOKE CREATE, TEMPORARY ON DATABASE postgres FROM PUBLIC;
    REVOKE ALL ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO rivalhub_preview_ro;
    GRANT CONNECT ON DATABASE postgres TO rivalhub_preview_ro;
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM rivalhub_preview_ro;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM rivalhub_preview_ro;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, rivalhub_preview_ro;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO rivalhub_preview_ro;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO rivalhub_preview_ro;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`);
  const tables = await client.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public'");
  for (const { tablename } of tables.rows) {
    // App tables have RLS deny-by-default; this dev-only SELECT policy is role-scoped.
    await client.query(`DROP POLICY IF EXISTS rivalhub_preview_read ON public.${quoteIdentifier(tablename)}`);
    await client.query(`CREATE POLICY rivalhub_preview_read ON public.${quoteIdentifier(tablename)} FOR SELECT TO rivalhub_preview_ro USING (true)`);
  }
}

async function provisionPersonas(snapshot: MirrorSnapshot, target: ReturnType<typeof targetEnvironment>) {
  const auth = createClient(target.supabaseUrl, target.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const active = snapshot.tables.users.filter((row) => row.status === "active");
  const used = new Set<unknown>();
  const bindings: { persona: typeof PERSONAS[number]; userId: string; authId: string; email: string }[] = [];
  const listing = await auth.auth.admin.listUsers({ perPage: 1000 });
  if (listing.error || listing.data.users.length >= 1000) throw new Error("Dev Auth inventory unavailable or exceeds bounded persona provisioning.");
  for (const persona of PERSONAS) {
    let row = persona === "captain" ? active.find((user) => !used.has(user.id) && snapshot.tables.teams.some((team) => team.captain_user_id === user.id))
      : persona === "invited" ? active.find((user) => !used.has(user.id) && snapshot.tables.competition_entry_participants.some((p) => p.user_id === user.id && p.status === "invited"))
        : active.find((user) => !used.has(user.id));
    if (!row) {
      // Missing representative role is reported, never presented as an observed production fact.
      if (persona === "captain" || persona === "invited") throw new Error(`Mirror has no representative ${persona}; explicit fixture selection is required.`);
      const id = createHash("sha256").update(`rivalhub-preview-${persona}`).digest("hex").slice(0, 32);
      row = { id: `${id.slice(0,8)}-${id.slice(8,12)}-4${id.slice(13,16)}-a${id.slice(17,20)}-${id.slice(20)}`, status: "active", role: "user", display_name: `Preview ${persona}` };
      snapshot.tables.users.push(row);
    }
    used.add(row.id);
    const email = `preview-${persona}@preview.invalid`;
    const existing = listing.data.users.find((user) => user.email === email);
    const result = existing
      ? await auth.auth.admin.updateUserById(existing.id, { password: target.personaPassword, email_confirm: true })
      : await auth.auth.admin.createUser({ email, password: target.personaPassword, email_confirm: true });
    if (result.error || !result.data.user) throw new Error(`Dev persona provisioning failed: ${persona}`);
    row.email = email;
    row.auth_id = result.data.user.id;
    row.email_verified_at = new Date().toISOString();
    row.email_verification_source = "admin_migration";
    row.role = persona === "super-admin" ? "super_admin" : "user";
    bindings.push({ persona, userId: String(row.id), authId: result.data.user.id, email });
  }
  return bindings;
}

export async function refreshMirror(path: string): Promise<void> {
  const target = targetEnvironment(); // Validate fixed target and credentials before any side effects.
  const snapshot = readSnapshot(path);
  const bindings = await provisionPersonas(snapshot, target);
  const pool = new Pool({ connectionString: target.databaseUrl, ssl: { rejectUnauthorized: false }, max: 1 });
  const client = await pool.connect();
  try {
    await migrateToSource(client, snapshot);
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = 'replica'");
    const tables = await client.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    await client.query(`TRUNCATE ${tables.rows.map(({ tablename }) => `public.${quoteIdentifier(tablename)}`).join(", ")} CASCADE`);
    for (const [table, rows] of Object.entries(snapshot.tables)) {
      if (!rows.length) continue;
      const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].map(quoteIdentifier).join(", ");
      await client.query(`INSERT INTO public.${quoteIdentifier(table)} (${columns}) SELECT ${columns} FROM jsonb_populate_recordset(NULL::public.${quoteIdentifier(table)}, $1::jsonb)`, [JSON.stringify(rows)]);
    }
    for (const binding of bindings) {
      for (const kind of ["auth", "email"]) {
        await client.query(`INSERT INTO public.user_identities (user_id, kind, provider, provider_subject, normalized_value, verified_at, provenance, is_primary)
          VALUES ($1, $2, $3, $4, $5, now(), 'admin_migration', true)`,
        [binding.userId, kind, kind === "auth" ? "supabase_auth" : "email", kind === "auth" ? binding.authId : binding.email, binding.email]);
      }
      if (binding.persona === "season-admin" && snapshot.tables.seasons[0]) {
        await client.query("INSERT INTO public.season_admin_grants (user_id, season_id) VALUES ($1, $2)", [binding.userId, snapshot.tables.seasons[0].id]);
      }
    }
    await client.query("SET LOCAL session_replication_role = 'origin'");
    await verifyForeignKeys(client);
    await provisionReadOnlyRole(client, target.readOnlyPassword);
    await client.query("COMMIT");
    console.log(`Mirror refreshed: source=${snapshot.sourceTag} commit=${snapshot.sourceCommit} time=${snapshot.refreshedAt} personas=${bindings.length}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); await pool.end(); }
}

if (process.argv[1]?.endsWith("preview/refresh.ts")) {
  refreshMirror(process.argv[2]).catch(() => { console.error("Mirror refresh failed; provider errors and row values are not logged."); process.exitCode = 1; });
}

import { postgresConnection } from "../../../src/db/postgres-connection";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrateCanonicalDatabase } from "../canonical-migrate";
import { assertActiveChainPrefix, identifyMigrationChain, readExpectedMigrations } from "../production-preflight";
import { verifyForeignKeys } from "../recovery/verify";
import { targetEnvironment } from "./environment";
import { readSnapshot, type MirrorSnapshot } from "./snapshot";
import { quoteIdentifier } from "./policy";
import { deterministicUserId, PREVIEW_PERSONAS, PREVIEW_PERSONA_PASSWORD, syntheticUserId, type PersonaBinding } from "./personas";
import {
  PreviewMirrorError,
  PreviewRefreshPhaseError,
  previewProviderFailure,
  reportPreviewFailure,
  type PreviewRefreshPhase,
} from "./diagnostics";

export { PreviewRefreshPhaseError } from "./diagnostics";

const MIRROR_STATE_TABLE = "preview_mirror_state";
const IMPORT_BATCH_BYTES = 1_000_000;
const IMPORT_BATCH_ROWS = 250;
const PREVIEW_TEAM_LOGO_BUCKET = "team-logos";
const PREVIEW_TEAM_LOGO_BUCKET_OPTIONS = {
  public: true,
  fileSizeLimit: 1_048_576,
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
};

export async function runPreviewRefreshPhase<T>(
  phase: PreviewRefreshPhase,
  operation: () => Promise<T>,
  log: (message: string) => void = console.log,
): Promise<T> {
  log(`Preview mirror phase: ${phase}`);
  try {
    const result = await operation();
    log(`Preview mirror phase complete: ${phase}`);
    return result;
  } catch (error) {
    throw new PreviewRefreshPhaseError(phase, error);
  }
}

export async function ensurePreviewTeamLogoBucket(
  storage: Pick<SupabaseClient["storage"], "getBucket" | "createBucket" | "updateBucket">,
): Promise<void> {
  let existing: Awaited<ReturnType<typeof storage.getBucket>>;
  try {
    existing = await storage.getBucket(PREVIEW_TEAM_LOGO_BUCKET);
  } catch (error) {
    throw previewProviderFailure("dev storage preflight", error);
  }
  if (existing.error && !isMissingStorageBucketError(existing.error)) {
    throw previewProviderFailure("dev storage preflight", existing.error);
  }

  try {
    if (existing.data) {
      const result = await storage.updateBucket(PREVIEW_TEAM_LOGO_BUCKET, PREVIEW_TEAM_LOGO_BUCKET_OPTIONS);
      if (result.error) throw previewProviderFailure("dev storage preflight", result.error);
    } else {
      const result = await storage.createBucket(PREVIEW_TEAM_LOGO_BUCKET, PREVIEW_TEAM_LOGO_BUCKET_OPTIONS);
      if (result.error) throw previewProviderFailure("dev storage preflight", result.error);
    }
  } catch (error) {
    if (error instanceof PreviewMirrorError) throw error;
    throw previewProviderFailure("dev storage preflight", error);
  }
}

export async function resetDevSchema(client: Pick<PoolClient, "query">): Promise<void> {
  // Keep the provider-initialized public namespace itself: replacing it loses
  // its owner, ACL and namespace-specific default privileges. Extension-owned
  // members are provider objects and must survive the application reset.
  await client.query("BEGIN");
  try {
    await client.query(`DO $$
    DECLARE object record;
    BEGIN
      IF to_regnamespace('public') IS NULL THEN
        RAISE EXCEPTION 'Preview target has no public schema';
      END IF;
      -- DROP SCHEMA used to remove every namespace-owned object. Refuse any
      -- object kind this narrower reset cannot account for, rather than
      -- silently carrying unknown objects into the imported mirror.
      IF EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.refclassid = 'pg_namespace'::regclass AND d.refobjid = 'public'::regnamespace AND d.deptype = 'n'
          AND d.classid NOT IN ('pg_class'::regclass, 'pg_proc'::regclass, 'pg_type'::regclass, 'pg_extension'::regclass)
          AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = d.classid AND e.objid = d.objid AND e.deptype = 'e')
      ) OR EXISTS (
        SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
          AND c.relkind NOT IN ('r','p','v','m','S','f','i','I','c')
          AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = 'pg_class'::regclass AND e.objid = c.oid AND e.deptype = 'e')
      ) OR EXISTS (
        SELECT 1 FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace
          AND t.typtype NOT IN ('e','d','c','r','m') AND t.typelem = 0
          AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = 'pg_type'::regclass AND e.objid = t.oid AND e.deptype = 'e')
      ) THEN
        RAISE EXCEPTION 'Preview public schema has unsupported objects; reset refused';
      END IF;
      IF to_regclass('realtime.messages') IS NOT NULL THEN
        DROP POLICY IF EXISTS rivalhub_match_live_receive ON realtime.messages;
      END IF;
      -- CASCADE is needed for interdependent application objects. Never let
      -- it remove a dependent owned by another schema or an unknown owner.
      IF EXISTS (
        SELECT 1 FROM pg_depend d
        CROSS JOIN LATERAL pg_identify_object(d.refclassid, d.refobjid, d.refobjsubid) referenced
        CROSS JOIN LATERAL pg_identify_object(d.classid, d.objid, d.objsubid) dependent
        LEFT JOIN pg_trigger t ON d.classid = 'pg_trigger'::regclass AND t.oid = d.objid
        LEFT JOIN pg_constraint con ON d.classid = 'pg_constraint'::regclass AND con.oid = d.objid
        LEFT JOIN pg_attrdef ad ON d.classid = 'pg_attrdef'::regclass AND ad.oid = d.objid
        LEFT JOIN pg_rewrite rw ON d.classid = 'pg_rewrite'::regclass AND rw.oid = d.objid
        LEFT JOIN pg_policy pol ON d.classid = 'pg_policy'::regclass AND pol.oid = d.objid
        LEFT JOIN pg_class rel ON rel.oid = coalesce(t.tgrelid, con.conrelid, ad.adrelid, rw.ev_class, pol.polrelid)
        LEFT JOIN pg_namespace ns ON ns.oid = rel.relnamespace
        WHERE referenced.schema = 'public' AND d.deptype = 'n'
          AND coalesce(dependent.schema, ns.nspname) IS DISTINCT FROM 'public'
          AND NOT EXISTS (SELECT 1 FROM pg_depend e WHERE e.classid = d.refclassid AND e.objid = d.refobjid AND e.deptype = 'e')
      ) THEN
        RAISE EXCEPTION 'Preview public schema has external dependencies; reset refused';
      END IF;
      FOR object IN
        SELECT c.relkind, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
      LOOP
        EXECUTE format('DROP %s IF EXISTS public.%I CASCADE',
          CASE object.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW'
            WHEN 'S' THEN 'SEQUENCE' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END, object.relname);
      END LOOP;
      FOR object IN
        SELECT p.proname, p.prokind, pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
      LOOP
        EXECUTE format('DROP %s IF EXISTS public.%I(%s) CASCADE',
          CASE object.prokind WHEN 'a' THEN 'AGGREGATE' ELSE 'ROUTINE' END, object.proname, object.args);
      END LOOP;
      FOR object IN
        SELECT t.typname, t.typtype FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        LEFT JOIN pg_class c ON c.oid = t.typrelid
        WHERE n.nspname = 'public' AND t.typtype IN ('e','d','c','r','m') AND t.typelem = 0
          AND (t.typrelid = 0 OR c.relkind = 'c')
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
      LOOP
        EXECUTE format('DROP %s IF EXISTS public.%I CASCADE', CASE object.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END, object.typname);
      END LOOP;
    END $$`);
    await client.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function migrateToSource(client: PoolClient, snapshot: MirrorSnapshot): Promise<void> {
  const exists = await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS ledger");
  const actual = exists.rows[0].ledger ? (await client.query("SELECT hash, created_at::text AS when FROM drizzle.__drizzle_migrations ORDER BY created_at")).rows
    .map((row) => ({ hash: String(row.hash), when: Number(row.when) })) : [];
  assertActiveChainPrefix(actual, snapshot.migrations);
  const source = identifyMigrationChain(snapshot.migrations);
  const folder = mkdtempSync(join(tmpdir(), "rivalhub-preview-migrations-"));
  try {
    mkdirSync(join(folder, "meta"));
    const journal = JSON.parse(readFileSync(`${source.directory}/meta/_journal.json`, "utf8"));
    journal.entries = journal.entries.slice(0, snapshot.migrations.length);
    writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify(journal));
    for (const entry of source.migrations.slice(0, snapshot.migrations.length)) copyFileSync(`${source.directory}/${entry.tag}.sql`, join(folder, `${entry.tag}.sql`));
    await migrateCanonicalDatabase(drizzle(client), folder);
  } finally { rmSync(folder, { recursive: true, force: true }); }
}

async function migrateCurrent(client: PoolClient): Promise<void> {
  await migrateCanonicalDatabase(drizzle(client), "drizzle/migrations", client);
}

async function ensureMirrorState(client: PoolClient): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS public.${MIRROR_STATE_TABLE} (
    id boolean PRIMARY KEY DEFAULT true CHECK (id), source_tag text NOT NULL,
    source_commit char(40) NOT NULL, refreshed_at timestamptz NOT NULL,
    persona_count integer NOT NULL, asset_count integer NOT NULL
  )`);
}

type RefreshDataPhases = {
  importSnapshot: (client: PoolClient, snapshot: MirrorSnapshot) => Promise<void>;
  verify: (client: PoolClient) => Promise<unknown>;
  migrateCurrent: (client: PoolClient) => Promise<void>;
};

export async function importSnapshot(client: Pick<PoolClient, "query">, snapshot: MirrorSnapshot): Promise<void> {
  await client.query("BEGIN");
  await client.query("SET LOCAL session_replication_role = 'replica'");
  const tables = await client.query<{ tablename: string }>(`SELECT tablename FROM pg_tables tables WHERE schemaname='public' AND tablename <> $1
    AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e'
      WHERE n.nspname=tables.schemaname AND c.relname=tables.tablename)`, [MIRROR_STATE_TABLE]);
  if (tables.rows.length) await client.query(`TRUNCATE ${tables.rows.map(({ tablename }) => `public.${quoteIdentifier(tablename)}`).join(", ")} CASCADE`);
  for (const [table, rows] of Object.entries(snapshot.tables)) {
    if (!rows.length) continue;
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].map(quoteIdentifier).join(", ");
    const sql = `INSERT INTO public.${quoteIdentifier(table)} (${columns}) SELECT ${columns} FROM jsonb_populate_recordset(NULL::public.${quoteIdentifier(table)}, $1::jsonb)`;
    let batch: string[] = [];
    let bytes = 2;
    for (const row of rows) {
      const encoded = JSON.stringify(row);
      const size = Buffer.byteLength(encoded) + 1;
      if (batch.length && (batch.length >= IMPORT_BATCH_ROWS || bytes + size > IMPORT_BATCH_BYTES)) {
        await client.query(sql, [`[${batch.join(",")}]`]);
        batch = [];
        bytes = 2;
      }
      batch.push(encoded);
      bytes += size;
    }
    if (batch.length) await client.query(sql, [`[${batch.join(",")}]`]);
    console.log(`Preview mirror imported table ${table}: ${rows.length} rows`);
  }
  await client.query("SET LOCAL session_replication_role = 'origin'");
  await client.query("COMMIT");
}

export async function importAndMigrateSnapshot(
  client: PoolClient,
  snapshot: MirrorSnapshot,
  applyCurrentMigrations: boolean,
  phases: RefreshDataPhases = { importSnapshot, verify: verifyForeignKeys, migrateCurrent },
): Promise<void> {
  await phases.importSnapshot(client, snapshot);
  await phases.verify(client);
  if (applyCurrentMigrations) {
    await phases.migrateCurrent(client);
    await phases.verify(client);
  }
}

async function provisionPersonas(snapshot: MirrorSnapshot, target: ReturnType<typeof targetEnvironment>): Promise<PersonaBinding[]> {
  const auth = createClient(target.supabaseUrl, target.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const active = snapshot.tables.users.filter((user) => user.status === "active");
  const used = new Set<string>();
  const bindings: PersonaBinding[] = [];
  let listing: Awaited<ReturnType<typeof auth.auth.admin.listUsers>>;
  try {
    listing = await auth.auth.admin.listUsers({ perPage: 1000 });
  } catch (error) {
    throw previewProviderFailure("persona auth", error);
  }
  if (listing.error) throw previewProviderFailure("persona auth", listing.error);
  if (listing.data.users.length >= 1000) throw new Error("Dev Auth inventory exceeds bounded persona provisioning.");
  for (const persona of PREVIEW_PERSONAS) {
    let id = deterministicUserId(active, snapshot.personaCandidates, persona, used);
    if (!id) {
      id = syntheticUserId(persona);
      snapshot.tables.users.push({ id, status: "active", display_name: `Preview ${persona}` });
    }
    used.add(id);
    const email = `preview-${persona}@preview.invalid`;
    const existing = listing.data.users.find((user) => user.email === email);
    let result: Awaited<ReturnType<typeof auth.auth.admin.createUser>>;
    try {
      result = existing
        ? await auth.auth.admin.updateUserById(existing.id, { password: PREVIEW_PERSONA_PASSWORD, email_confirm: true })
        : await auth.auth.admin.createUser({ email, password: PREVIEW_PERSONA_PASSWORD, email_confirm: true });
    } catch (error) {
      throw previewProviderFailure("persona auth", error);
    }
    if (result.error) throw previewProviderFailure("persona auth", result.error);
    if (!result.data.user) throw new Error("Dev persona provisioning returned no user.");
    const row = snapshot.tables.users.find((user) => String(user.id) === id);
    if (!row) throw new Error("Persona source row disappeared during refresh.");
    row.email = email; row.auth_id = result.data.user.id; row.email_verified_at = new Date().toISOString(); row.email_verification_source = "admin_migration"; row.role = persona === "super-admin" ? "super_admin" : "user";
    bindings.push({ persona, userId: id, authId: result.data.user.id, email });
  }
  return bindings;
}

export async function refreshMirror(path: string): Promise<void> {
  const target = await runPreviewRefreshPhase("dev storage preflight", async () => targetEnvironment());
  const snapshot = await runPreviewRefreshPhase("snapshot read", async () => readSnapshot(path));
  const storage = createClient(target.supabaseUrl, target.secretKey, { auth: { persistSession: false, autoRefreshToken: false } }).storage;
  await runPreviewRefreshPhase("dev storage preflight", () => ensurePreviewTeamLogoBucket(storage));
  const pool = new Pool({ ...postgresConnection(target.databaseUrl), max: 1, query_timeout: 120_000 });
  let client: PoolClient | undefined;
  try {
    const connected = await runPreviewRefreshPhase("db connection", () => pool.connect());
    client = connected;
    await runPreviewRefreshPhase("db reset", () => resetDevSchema(connected));
    await runPreviewRefreshPhase("db migrate", () => migrateToSource(connected, snapshot));
    await runPreviewRefreshPhase("db import", () => importAndMigrateSnapshot(connected, snapshot, target.applyCurrentMigrations));
    await runPreviewRefreshPhase("db state setup", () => ensureMirrorState(connected));
    // Current domain code requires the current schema; older source-only mirrors stay readable.
    if (target.applyCurrentMigrations || identifyMigrationChain(snapshot.migrations).directory === "drizzle/migrations" && snapshot.migrations.length === readExpectedMigrations().length) {
      await runPreviewRefreshPhase("pickem windows", async () => {
        const [{ initializePreviewPickEm }, schema] = await Promise.all([
          import("./predictions"), import("../../../src/db/schema"),
        ]);
        await initializePreviewPickEm(drizzle(connected, { schema }));
      });
    }

    const bindings = await runPreviewRefreshPhase("persona auth", () => provisionPersonas(snapshot, target));
    await runPreviewRefreshPhase("persona db binding", async () => {
      await connected.query("BEGIN");
      for (const binding of bindings) {
        const role = binding.persona === "super-admin" ? "super_admin" : "user";
        // A sparse production snapshot may not contain five distinct active
        // users. Synthetic persona rows are added after the bulk import, so
        // insert the missing row before binding its deterministic Auth identity.
        await connected.query(
          `INSERT INTO public.users (id, status, display_name, email, role)
           VALUES ($1, 'active', $2, $3, $4)
           ON CONFLICT (id) DO NOTHING`,
          [binding.userId, `Preview ${binding.persona}`, binding.email, role],
        );
        await connected.query("UPDATE public.users SET auth_id=$1, email=$2, email_verified_at=now(), email_verification_source='admin_migration', role=$3, updated_at=now() WHERE id=$4", [binding.authId, binding.email, binding.persona === "super-admin" ? "super_admin" : "user", binding.userId]);
        await connected.query(`INSERT INTO public.user_identities (user_id, kind, provider, provider_subject, normalized_value, verified_at, provenance, is_primary)
          VALUES ($1, 'auth', 'supabase_auth', $2, $3, now(), 'admin_migration', true), ($1, 'email', 'email', $3, $3, now(), 'admin_migration', true) ON CONFLICT DO NOTHING`, [binding.userId, binding.authId, binding.email]);
        if (binding.persona === "season-admin" && snapshot.personaCandidates.currentSeasonId) await connected.query("INSERT INTO public.season_admin_grants (user_id, season_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [binding.userId, snapshot.personaCandidates.currentSeasonId]);
      }
    });
    await runPreviewRefreshPhase("public asset upload", () => uploadAssets(snapshot, target));
    await runPreviewRefreshPhase("mirror state commit", async () => {
      await connected.query(`INSERT INTO public.${MIRROR_STATE_TABLE} (id, source_tag, source_commit, refreshed_at, persona_count, asset_count)
        VALUES (true, $1, $2, now(), $3, $4)
        ON CONFLICT (id) DO UPDATE SET source_tag=EXCLUDED.source_tag, source_commit=EXCLUDED.source_commit,
        refreshed_at=EXCLUDED.refreshed_at, persona_count=EXCLUDED.persona_count, asset_count=EXCLUDED.asset_count`, [snapshot.sourceTag, snapshot.sourceCommit, bindings.length, snapshot.assets.length]);
      await connected.query("COMMIT");
    });
    console.log(`Mirror refreshed: source=${snapshot.sourceTag} commit=${snapshot.sourceCommit} personas=${bindings.length} assets=${snapshot.assets.length}`);
  } catch (error) {
    await client?.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client?.release(); await pool.end(); }
}

function isMissingStorageBucketError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  try {
    const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown };
    return candidate.status === 404
      || candidate.statusCode === 404
      || candidate.statusCode === "404"
      || candidate.code === "NotFound";
  } catch {
    return false;
  }
}

async function uploadAssets(snapshot: MirrorSnapshot, target: ReturnType<typeof targetEnvironment>): Promise<void> {
  if (!snapshot.assets.length) return;
  const storage = createClient(target.supabaseUrl, target.secretKey, { auth: { persistSession: false, autoRefreshToken: false } }).storage;
  for (const asset of snapshot.assets) {
    const bucket = storage.from(asset.bucket);
    let result: Awaited<ReturnType<typeof bucket.upload>>;
    try {
      result = await bucket.upload(asset.path, Buffer.from(asset.data, "base64"), { contentType: asset.contentType, upsert: true });
    } catch (error) {
      throw previewProviderFailure("public asset upload", error);
    }
    if (result.error) throw previewProviderFailure("public asset upload", result.error);
  }
}

if (process.argv[1]?.endsWith("preview/refresh.ts")) refreshMirror(process.argv[2]).catch((error: unknown) => {
  reportPreviewFailure("preview.mirror.refresh_failed", error, { operation: "refresh" });
  process.exitCode = 1;
});

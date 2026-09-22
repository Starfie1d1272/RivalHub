import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { assertActiveChainPrefix, readExpectedMigrations } from "../production-preflight";
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

async function resetDevSchema(client: PoolClient): Promise<void> {
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
  await client.query("GRANT ALL ON SCHEMA public TO postgres");
  await client.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
}

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
    for (const entry of readExpectedMigrations().slice(0, snapshot.migrations.length)) copyFileSync(`drizzle/migrations/${entry.tag}.sql`, join(folder, `${entry.tag}.sql`));
    await migrate(drizzle(client), { migrationsFolder: folder });
  } finally { rmSync(folder, { recursive: true, force: true }); }
}

async function migrateCurrent(client: PoolClient): Promise<void> {
  await migrate(drizzle(client), { migrationsFolder: "drizzle/migrations" });
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

export async function importSnapshot(client: PoolClient, snapshot: MirrorSnapshot): Promise<void> {
  await client.query("BEGIN");
  await client.query("SET LOCAL session_replication_role = 'replica'");
  const tables = await client.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> $1", [MIRROR_STATE_TABLE]);
  if (tables.rows.length) await client.query(`TRUNCATE ${tables.rows.map(({ tablename }) => `public.${quoteIdentifier(tablename)}`).join(", ")} CASCADE`);
  for (const [table, rows] of Object.entries(snapshot.tables)) {
    if (!rows.length) continue;
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].map(quoteIdentifier).join(", ");
    await client.query(`INSERT INTO public.${quoteIdentifier(table)} (${columns}) SELECT ${columns} FROM jsonb_populate_recordset(NULL::public.${quoteIdentifier(table)}, $1::jsonb)`, [JSON.stringify(rows)]);
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
  const pool = new Pool({ connectionString: target.databaseUrl, ssl: { rejectUnauthorized: false }, max: 1 });
  let client: PoolClient | undefined;
  try {
    const connected = await runPreviewRefreshPhase("db connection", () => pool.connect());
    client = connected;
    await runPreviewRefreshPhase("db reset", () => resetDevSchema(connected));
    await runPreviewRefreshPhase("db migrate", () => migrateToSource(connected, snapshot));
    await runPreviewRefreshPhase("db import", () => importAndMigrateSnapshot(connected, snapshot, target.applyCurrentMigrations));
    await runPreviewRefreshPhase("db state setup", () => ensureMirrorState(connected));

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

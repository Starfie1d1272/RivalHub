import { Pool } from "pg";
import { assertPreviewDatabaseUrl } from "../../../src/lib/runtime/preview";
import { buildStagingReadonlyDatabaseUrl } from "../staging-environment";

function readOnlyUrl(): string {
  const value = process.env.RIVALHUB_PREVIEW_READONLY_DATABASE_URL;
  if (value) return value;
  const password = process.env.RIVALHUB_PREVIEW_RO_PASSWORD;
  if (!password) throw new Error("Preview read-only URL or protected role password is required.");
  return buildStagingReadonlyDatabaseUrl(password);
}

export async function verifyPreviewReadOnly(): Promise<void> {
  const url = readOnlyUrl();
  assertPreviewDatabaseUrl(url, { ...process.env, VERCEL_ENV: "preview" });
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });
  const client = await pool.connect();
  try {
    const identity = await client.query<{ current_user: string; can_select: boolean; can_insert: boolean; can_update: boolean; can_delete: boolean; can_create: boolean }>(`SELECT current_user,
      has_table_privilege(current_user, 'public.users', 'SELECT') AS can_select,
      has_table_privilege(current_user, 'public.users', 'INSERT') AS can_insert,
      has_table_privilege(current_user, 'public.users', 'UPDATE') AS can_update,
      has_table_privilege(current_user, 'public.users', 'DELETE') AS can_delete,
      has_schema_privilege(current_user, 'public', 'CREATE') AS can_create`);
    const row = identity.rows[0];
    if (row.current_user !== "rivalhub_preview_ro" || !row.can_select || row.can_insert || row.can_update || row.can_delete || row.can_create) throw new Error("Preview role privilege contract failed.");
    await client.query("SELECT id FROM public.seasons LIMIT 1");
    await expectRejected(client, "INSERT INTO public.users (id, email, status, role) VALUES (gen_random_uuid(), 'ro-probe@preview.invalid', 'active', 'user')");
    await expectRejected(client, "UPDATE public.users SET display_name = display_name WHERE false");
    await expectRejected(client, "DELETE FROM public.users WHERE false");
    await expectRejected(client, "CREATE TABLE public.preview_ro_probe (id integer)");
    const executable = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege(current_user, p.oid, 'EXECUTE')");
    if (Number(executable.rows[0]?.count ?? 0) !== 0) throw new Error("Preview role unexpectedly has function EXECUTE.");
    const state = await client.query<{ ready: boolean; source_tag: string; source_commit: string; refreshed_at: string }>("SELECT ready, source_tag, source_commit, refreshed_at::text FROM public.preview_mirror_state WHERE id=true");
    if (!state.rows[0]?.ready || !/^[a-f0-9]{40}$/.test(state.rows[0].source_commit)) throw new Error("Preview mirror is not refresh-ready.");
    console.log(`Preview read-only verified: user=${row.current_user} ready=${state.rows[0].ready} source=${state.rows[0].source_tag} refreshed=${state.rows[0].refreshed_at}`);
  } finally { client.release(); await pool.end(); }
}

async function expectRejected(client: { query: (text: string) => Promise<unknown> }, sql: string): Promise<void> {
  try { await client.query(sql); } catch { return; }
  throw new Error("Preview read-only mutation unexpectedly succeeded.");
}

if (process.argv[1]?.endsWith("preview/verify.ts")) verifyPreviewReadOnly().catch(() => { console.error("Preview role verification failed; no provider error is logged."); process.exitCode = 1; });

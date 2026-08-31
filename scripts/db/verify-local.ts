import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import {
  assertDeclaredDatabaseTarget,
  assertLocalDatabaseUrl,
  assertLocalHttpUrl,
} from "./local-environment";

async function main(): Promise<void> {
  assertDeclaredDatabaseTarget(process.env);

  const privateDataApiTables = [
    "competitive_platforms",
    "competitive_platform_ranks",
    "competitive_platform_seasons",
    "competitive_rank_facts",
  ] as const;
  // Probe columns must exist on every table; competitive_platforms keys on
  // `key` instead of a uuid `id`.
  const privateDataApiProbeColumns: Record<(typeof privateDataApiTables)[number], string> = {
    competitive_platforms: "key",
    competitive_platform_ranks: "id",
    competitive_platform_seasons: "id",
    competitive_rank_facts: "id",
  };

  const databaseUrl = assertLocalDatabaseUrl(process.env.DATABASE_URL);
  const apiUrl = assertLocalHttpUrl(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    "NEXT_PUBLIC_SUPABASE_URL",
  );
  const publishableKey = required(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "publishable key");
  const serviceRoleKey = required(process.env.SUPABASE_SERVICE_ROLE_KEY, "service role key");
  const journal = JSON.parse(
    readFileSync(resolve(process.cwd(), "drizzle/migrations/meta/_journal.json"), "utf8"),
  ) as { entries: unknown[] };

  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 1 });
  let createdUserId: string | undefined;
  let createdBucketId: string | undefined;

  try {
    const databaseFacts = await pool.query<{
    migration_count: string;
    seasons_table: string | null;
    teams_table: string | null;
    auth_schema: string | null;
    storage_schema: string | null;
    fixture_count: string;
    }>(`
    SELECT
      (SELECT count(*)::text FROM drizzle.__drizzle_migrations) AS migration_count,
      to_regclass('public.seasons')::text AS seasons_table,
      to_regclass('public.teams')::text AS teams_table,
      to_regnamespace('auth')::text AS auth_schema,
      to_regnamespace('storage')::text AS storage_schema,
      (SELECT count(*)::text FROM public.seasons WHERE slug = 'local-major-2027') AS fixture_count
    `);
    const facts = databaseFacts.rows[0];
    if (Number(facts.migration_count) !== journal.entries.length) {
      throw new Error(
        `Drizzle migration ledger 不完整：${facts.migration_count}/${journal.entries.length}。`,
      );
    }
    if (!facts.seasons_table || !facts.teams_table) {
      throw new Error("Drizzle baseline 关键业务表缺失。");
    }
    if (!facts.auth_schema || !facts.storage_schema) {
      throw new Error("Local Supabase Auth/Storage schema 缺失。");
    }
    if (Number(facts.fixture_count) !== 1) {
      throw new Error("本地 Major fixture 缺失或不唯一。");
    }

    const rlsFacts = await pool.query<{
      table_name: string;
      rls_enabled: boolean;
      anon_select: boolean;
      authenticated_select: boolean;
    }>(
      `
      SELECT
        c.relname AS table_name,
        c.relrowsecurity AS rls_enabled,
        has_table_privilege('anon', format('public.%I', c.relname), 'SELECT') AS anon_select,
        has_table_privilege('authenticated', format('public.%I', c.relname), 'SELECT') AS authenticated_select
      FROM pg_class c
      INNER JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1::text[])
      `,
      [privateDataApiTables],
    );
    const rlsByTable = new Map(rlsFacts.rows.map((row) => [row.table_name, row]));
    for (const tableName of privateDataApiTables) {
      const row = rlsByTable.get(tableName);
      if (!row || !row.rls_enabled || row.anon_select || row.authenticated_select) {
        throw new Error(`${tableName} 未满足 Local Data API deny-by-default / RLS 约束。`);
      }
    }

    const client = createClient(apiUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = `verify-${randomUUID()}@rivalhub.local`;
    const createdUser = await client.auth.admin.createUser({
      email,
      password: `Local-${randomUUID()}-pass`,
      email_confirm: true,
    });
    if (createdUser.error || !createdUser.data.user) {
      throw new Error(`Local Auth 验证失败：${createdUser.error?.message ?? "unknown"}`);
    }
    createdUserId = createdUser.data.user.id;

    createdBucketId = `verify-${randomUUID()}`;
    const createdBucket = await client.storage.createBucket(createdBucketId, { public: false });
    if (createdBucket.error) {
      throw new Error(`Local Storage bucket 验证失败：${createdBucket.error.message}`);
    }
    const uploaded = await client.storage
      .from(createdBucketId)
      .upload("probe.txt", new Blob(["rivalhub-local-storage-probe"]), {
        contentType: "text/plain",
      });
    if (uploaded.error) {
      throw new Error(`Local Storage upload 验证失败：${uploaded.error.message}`);
    }
    const downloaded = await client.storage.from(createdBucketId).download("probe.txt");
    if (downloaded.error || (await downloaded.data.text()) !== "rivalhub-local-storage-probe") {
      throw new Error(`Local Storage download 验证失败：${downloaded.error?.message ?? "content mismatch"}`);
    }

    const anonRead = await fetch(`${apiUrl}/rest/v1/seasons?select=id&limit=1`, {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
      },
    });
    if (anonRead.status !== 401 && anonRead.status !== 403) {
      throw new Error(
        `public.seasons 的匿名 Data API 结果不是明确拒绝（HTTP ${anonRead.status}）。`,
      );
    }
    for (const tableName of privateDataApiTables) {
      const response = await fetch(`${apiUrl}/rest/v1/${tableName}?select=${privateDataApiProbeColumns[tableName]}&limit=1`, {
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${publishableKey}`,
        },
      });
      if (response.status !== 401 && response.status !== 403) {
        throw new Error(
          `${tableName} 的匿名 Data API 结果不是明确拒绝（HTTP ${response.status}）。`,
        );
      }
    }

    console.log(
      `Local verification passed: ${journal.entries.length} migrations, fixture, Auth, Storage, Data API deny-by-default.`,
    );
  } finally {
    const cleanupClient = createClient(apiUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    if (createdBucketId) {
      await cleanupClient.storage.from(createdBucketId).remove(["probe.txt"]);
      await cleanupClient.storage.deleteBucket(createdBucketId);
    }
    if (createdUserId) {
      await cleanupClient.auth.admin.deleteUser(createdUserId);
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

function required(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} 未设置。`);
  return value.trim();
}

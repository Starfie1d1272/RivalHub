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

const privateDataApiTables = [
  "competitive_platforms",
  "competitive_platform_ranks",
  "competitive_platform_seasons",
  "competitive_rank_facts",
  "community_awards",
  "community_award_evidence",
  "match_commentators",
  "post_match_reports",
] as const;

const privateDataApiProbeColumns: Record<(typeof privateDataApiTables)[number], string> = {
  competitive_platforms: "key",
  competitive_platform_ranks: "id",
  competitive_platform_seasons: "id",
  competitive_rank_facts: "id",
  community_awards: "id",
  community_award_evidence: "id",
  match_commentators: "match_id",
  post_match_reports: "match_id",
};

export async function verifyDatabaseContract(): Promise<void> {
  assertDeclaredDatabaseTarget(process.env);
  const databaseUrl = assertLocalDatabaseUrl(process.env.DATABASE_URL);
  const journal = JSON.parse(
    readFileSync(resolve(process.cwd(), "drizzle/migrations/meta/_journal.json"), "utf8"),
  ) as { entries: unknown[] };
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 1 });

  try {
    const databaseFacts = await pool.query<{
      migration_count: string;
      seasons_table: string | null;
      teams_table: string | null;
      fixture_count: string;
    }>(`
      SELECT
        (SELECT count(*)::text FROM drizzle.__drizzle_migrations) AS migration_count,
        to_regclass('public.seasons')::text AS seasons_table,
        to_regclass('public.teams')::text AS teams_table,
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
        throw new Error(`${tableName} 未满足 PostgreSQL deny-by-default / RLS 约束。`);
      }
    }

    console.log(
      `PostgreSQL verification passed: ${journal.entries.length} migrations, fixture, RLS/grant deny-by-default.`,
    );
  } finally {
    await pool.end();
  }
}

export async function verifySupabaseServices(): Promise<void> {
  assertDeclaredDatabaseTarget(process.env);
  const apiUrl = assertLocalHttpUrl(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    "NEXT_PUBLIC_SUPABASE_URL",
  );
  const publishableKey = required(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "publishable key");
  const serviceRoleKey = required(process.env.SUPABASE_SERVICE_ROLE_KEY, "service role key");
  const client = createClient(apiUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let createdUserId: string | undefined;
  let createdBucketId: string | undefined;

  try {
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

    console.log("Supabase service verification passed: Auth, Storage, Data API deny-by-default.");
  } finally {
    if (createdBucketId) {
      await client.storage.from(createdBucketId).remove(["probe.txt"]);
      await client.storage.deleteBucket(createdBucketId);
    }
    if (createdUserId) {
      await client.auth.admin.deleteUser(createdUserId);
    }
  }
}

function required(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} 未设置。`);
  return value.trim();
}

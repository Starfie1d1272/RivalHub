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
import { DATABASE_ACCESS_MATRIX, verifyDatabaseAccessMatrix } from "./access-matrix";
import { verifyEducationEvidenceBucket } from "./verify-migrations";

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

    await verifyDatabaseAccessMatrix(pool, "Local PostgreSQL");
    await verifyEducationEvidenceBucket(pool);

    console.log(
      `PostgreSQL verification passed: ${journal.entries.length} migrations, fixture, full public access matrix.`,
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
  const databaseUrl = assertLocalDatabaseUrl(process.env.DATABASE_URL);
  const publishableKey = required(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "publishable key");
  const serviceRoleKey = required(process.env.SUPABASE_SERVICE_ROLE_KEY, "service role key");
  const client = createClient(apiUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 1 });
  let createdUserId: string | undefined;
  let createdBucketId: string | undefined;
  const educationProbeKey = `verify/${randomUUID()}.png`;

  try {
    await verifyDatabaseAccessMatrix(pool, "Local Supabase");
    if (await verifyEducationEvidenceBucket(pool) !== "verified") {
      throw new Error("Local Supabase 缺少 education-evidence Storage bucket。");
    }

    const email = `verify-${randomUUID()}@rivalhub.local`;
    const password = `Local-${randomUUID()}-pass`;
    const createdUser = await client.auth.admin.createUser({
      email,
      password,
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

    const educationUploaded = await client.storage
      .from("education-evidence")
      .upload(educationProbeKey, new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: "image/png" }), {
        upsert: false,
        contentType: "image/png",
      });
    if (educationUploaded.error) throw new Error("Local education evidence service upload 验证失败。");
    const educationDownloaded = await client.storage.from("education-evidence").download(educationProbeKey);
    if (educationDownloaded.error || !educationDownloaded.data) {
      throw new Error("Local education evidence service download 验证失败。");
    }

    const authenticatedClient = createClient(apiUrl, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signedIn = await authenticatedClient.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session?.access_token) {
      throw new Error(`Local Auth authenticated session 验证失败：${signedIn.error?.message ?? "missing access token"}`);
    }

    await verifyDeniedDataApiAccess(apiUrl, publishableKey, publishableKey, "anon");
    await verifyDeniedDataApiAccess(
      apiUrl,
      publishableKey,
      signedIn.data.session.access_token,
      "authenticated",
    );

    const anonymousEvidence = await createClient(apiUrl, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }).storage.from("education-evidence").download(educationProbeKey);
    if (!anonymousEvidence.error || anonymousEvidence.data) {
      throw new Error("Local education evidence bucket 对 anon 未明确拒绝。");
    }
    const authenticatedEvidence = await authenticatedClient.storage
      .from("education-evidence")
      .download(educationProbeKey);
    if (!authenticatedEvidence.error || authenticatedEvidence.data) {
      throw new Error("Local education evidence bucket 对 authenticated 未明确拒绝。");
    }

    const signed = await client.storage
      .from("education-evidence")
      .createSignedUrl(educationProbeKey, 60);
    if (signed.error || !signed.data?.signedUrl) {
      throw new Error("Local education evidence signed URL 验证失败。");
    }
    const signedResponse = await fetch(signed.data.signedUrl);
    if (!signedResponse.ok) throw new Error("Local education evidence signed URL 读取验证失败。");

    const removedEducation = await client.storage.from("education-evidence").remove([educationProbeKey]);
    if (removedEducation.error) throw new Error("Local education evidence service remove 验证失败。");
    const afterRemove = await client.storage.from("education-evidence").download(educationProbeKey);
    if (!afterRemove.error || afterRemove.data) {
      throw new Error("Local education evidence remove 后仍可读取。");
    }

    console.log("Supabase service verification passed: Auth, Storage, full Data API deny-by-default.");
  } finally {
    await client.storage.from("education-evidence").remove([educationProbeKey]);
    if (createdBucketId) {
      await client.storage.from(createdBucketId).remove(["probe.txt"]);
      await client.storage.deleteBucket(createdBucketId);
    }
    if (createdUserId) {
      await client.auth.admin.deleteUser(createdUserId);
    }
    await pool.end();
  }
}

async function verifyDeniedDataApiAccess(
  apiUrl: string,
  publishableKey: string,
  token: string,
  role: "anon" | "authenticated",
): Promise<void> {
  const headers = {
    apikey: publishableKey,
    Authorization: `Bearer ${token}`,
  };
  for (const entry of DATABASE_ACCESS_MATRIX) {
    const response = await fetch(
      `${apiUrl}/rest/v1/${entry.table}?select=*&limit=1`,
      { headers },
    );
    if (![401, 403, 404].includes(response.status)) {
      throw new Error(
        `${role} Data API 对 public.${entry.table} 未明确拒绝（HTTP ${response.status}）。`,
      );
    }
  }
}

function required(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} 未设置。`);
  return value.trim();
}

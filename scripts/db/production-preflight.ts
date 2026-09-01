import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { assertProductionConfirmations, assertProductionDatabaseUrl } from "./production-environment";

interface MigrationJournalEntry { tag: string; when: number; }
interface Migration { hash: string; when: number; }

export async function verifyProductionPreflight(): Promise<void> {
  assertProductionConfirmations(process.env);
  const databaseUrl = assertProductionDatabaseUrl(process.env.DATABASE_URL);
  const expected = readExpectedMigrations();
  const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    await pool.query("BEGIN TRANSACTION READ ONLY");
    const ledger = await pool.query<Migration>("SELECT hash, created_at::bigint::text AS when FROM drizzle.__drizzle_migrations ORDER BY created_at");
    assertActiveChainPrefix(ledger.rows.map((row) => ({ hash: row.hash, when: Number(row.when) })), expected);
    if (ledger.rows.length !== 25 && ledger.rows.length !== expected.length) {
      throw new Error(`Production ledger 必须是已确认的 0024 前缀或完整 active chain；实际 ${ledger.rows.length}/${expected.length}。`);
    }

    // 0025 and 0026 are the only pending migrations on the current production
    // prefix. Run their destructive-data predicates read-only before Drizzle
    // is permitted to start the forward write.
    if (ledger.rows.length === 25) {
      await assert0024SchemaAndPendingData(pool);
    }
    await pool.query("ROLLBACK");
    console.log(`Production migration preflight passed: ledger is an active-chain prefix (${ledger.rows.length}/${expected.length}).`);
  } catch (error) {
    try { await pool.query("ROLLBACK"); } catch { /* no transaction to roll back */ }
    throw error;
  } finally {
    await pool.end();
  }
}

export function assertActiveChainPrefix(actual: readonly Migration[], expected: readonly Migration[]): void {
  if (actual.length > expected.length || actual.some((item, index) => item.hash !== expected[index]?.hash || item.when !== expected[index]?.when)) {
    throw new Error("Production Drizzle migration ledger 不是 active migration chain 的精确前缀；拒绝迁移。");
  }
}

export function readExpectedMigrations(): Migration[] {
  const migrationsDirectory = resolve(process.cwd(), "drizzle/migrations");
  const journal = JSON.parse(readFileSync(resolve(migrationsDirectory, "meta/_journal.json"), "utf8")) as { entries: MigrationJournalEntry[] };
  return journal.entries.map((entry) => ({
    hash: createHash("sha256").update(readFileSync(resolve(migrationsDirectory, `${entry.tag}.sql`), "utf8")).digest("hex"),
    when: entry.when,
  }));
}

async function assert0024SchemaAndPendingData(pool: Pool): Promise<void> {
  const result = await pool.query<{
    has_evidence_url: boolean;
    has_evidence_code: boolean;
    has_perfect_id: boolean;
    unsafe_chsi_rows: string;
    url_evidence_rows: string;
    noncanonical_roles: string;
  }>(`
    SELECT
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'education_verifications' AND column_name = 'evidence_url') AS has_evidence_url,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'education_verifications' AND column_name = 'evidence_code') AS has_evidence_code,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'perfect_id') AS has_perfect_id,
      (SELECT count(*)::text FROM education_verifications
       WHERE evidence_type IN ('chsi_enrollment_report', 'chsi_education_report')
         AND (evidence_url !~* '^https://(www\\.)?chsi\\.com\\.cn(?:/|[?#]|$)'
           OR (SELECT count(*) FROM regexp_matches(evidence_url, '(?i)[?&]vcode=', 'g')) <> 1
           OR upper((regexp_match(evidence_url, '(?i)[?&]vcode=([a-z0-9]{12}|[a-z0-9]{16})(?:[&#]|$)'))[1]) !~ '^(?:[A-Z0-9]{16}|[0-9]{12})$')) AS unsafe_chsi_rows,
      (SELECT count(*)::text FROM education_verifications
       WHERE evidence_type NOT IN ('chsi_enrollment_report', 'chsi_education_report') AND evidence_url IS NOT NULL) AS url_evidence_rows,
      (SELECT count(*)::text FROM user_competitive_roles WHERE role::text NOT IN ('igl', 'awper', 'opener', 'closer', 'anchor')) AS noncanonical_roles
  `);
  const facts = result.rows[0];
  if (!facts?.has_evidence_url || facts.has_evidence_code || !facts.has_perfect_id) {
    throw new Error("Production schema 不符合 0024 基线；拒绝对未知状态执行 0025/0026。");
  }
  if (facts.unsafe_chsi_rows !== "0" || facts.url_evidence_rows !== "0" || facts.noncanonical_roles !== "0") {
    throw new Error(`Production 0025/0026 fail-closed data validation 未通过：unsafe CHSI=${facts.unsafe_chsi_rows}, non-CHSI URL=${facts.url_evidence_rows}, non-canonical roles=${facts.noncanonical_roles}。`);
  }
}

if (require.main === module) {
  verifyProductionPreflight().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

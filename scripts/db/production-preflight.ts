import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { assertProductionConfirmations, assertProductionDatabaseUrl } from "./production-environment";

interface MigrationJournalEntry { tag: string; when: number; }
export interface Migration { hash: string; when: number; }
export interface ExpectedMigration extends Migration { tag: string; }

export const PRODUCTION_BASELINE_TAG = "0024_major_runtime_convergence";

export async function verifyProductionPreflight(): Promise<void> {
  assertProductionConfirmations(process.env);
  const databaseUrl = assertProductionDatabaseUrl(process.env.DATABASE_URL);
  const expected = readExpectedMigrations();
  const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false }, max: 1 });
  try {
    await pool.query("BEGIN TRANSACTION READ ONLY");
    const ledger = await pool.query<Migration>("SELECT hash, created_at::bigint::text AS when FROM drizzle.__drizzle_migrations ORDER BY created_at");
    const actual = ledger.rows.map((row) => ({ hash: row.hash, when: Number(row.when) }));
    const state = assertResumableProductionLedger(actual, expected);

    // At the confirmed 0024 baseline, prove the destructive-data predicates
    // for the currently pending 0025/0026 pair before Drizzle is permitted to
    // start the forward write. Once production has advanced beyond 0024, an
    // exact active-chain prefix is resumable: a failed later migration must
    // not make the canonical runner reject its own partial progress.
    if (state.atBaseline) {
      await assert0024SchemaAndPendingData(pool);
    }
    await pool.query("ROLLBACK");
    console.log(`Production migration preflight passed: ledger is a resumable active-chain prefix (${ledger.rows.length}/${expected.length}).`);
  } catch (error) {
    try { await pool.query("ROLLBACK"); } catch { /* no transaction to roll back */ }
    throw error;
  } finally {
    await pool.end();
  }
}

export function assertResumableProductionLedger(
  actual: readonly Migration[],
  expected: readonly ExpectedMigration[],
): { baselineLength: number; atBaseline: boolean } {
  assertActiveChainPrefix(actual, expected);
  const baselineIndex = expected.findIndex((migration) => migration.tag === PRODUCTION_BASELINE_TAG);
  if (baselineIndex < 0) {
    throw new Error(`Active migration chain 缺少已确认的 production baseline ${PRODUCTION_BASELINE_TAG}。`);
  }
  const baselineLength = baselineIndex + 1;
  if (actual.length < baselineLength) {
    throw new Error(
      `Production ledger 早于已确认的 ${PRODUCTION_BASELINE_TAG} baseline；实际 ${actual.length}/${expected.length}，拒绝自动前向迁移。`,
    );
  }
  return { baselineLength, atBaseline: actual.length === baselineLength };
}

export function assertActiveChainPrefix(actual: readonly Migration[], expected: readonly Migration[]): void {
  if (actual.length > expected.length || actual.some((item, index) => item.hash !== expected[index]?.hash || item.when !== expected[index]?.when)) {
    throw new Error("Production Drizzle migration ledger 不是 active migration chain 的精确前缀；拒绝迁移。");
  }
}

export function readExpectedMigrations(): ExpectedMigration[] {
  const migrationsDirectory = resolve(process.cwd(), "drizzle/migrations");
  const journal = JSON.parse(readFileSync(resolve(migrationsDirectory, "meta/_journal.json"), "utf8")) as { entries: MigrationJournalEntry[] };
  return journal.entries.map((entry) => ({
    tag: entry.tag,
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

import { resolve } from "node:path";
import type { Pool } from "pg";
import { isMigrationLedgerPrefix, readMigrationLedger, type MigrationIdentity } from "./migration-ledger";

export interface LegacyLedgerEntry extends MigrationIdentity { id: number; }

/** The candidate archive is trusted only if every original hash/time matches. */
export function assertLegacyLineage(entries: readonly LegacyLedgerEntry[]): void {
  const expected = readMigrationLedger(resolve(process.cwd(), "drizzle/v2-migrations"));
  if (entries.length !== expected.length || !entries.length || !isMigrationLedgerPrefix(entries, expected)
    || entries.some((entry, index) => !Number.isSafeInteger(entry.id) || entry.id < 1 || (index > 0 && entry.id <= entries[index - 1]!.id))) {
    throw new Error("Legacy migration archive is unknown or incomplete; recovery refused.");
  }
}

export async function readLegacyLineage(pool: Pick<Pool, "query">): Promise<LegacyLedgerEntry[] | undefined> {
  const relation = await pool.query<{ archive: string | null }>("SELECT to_regclass('drizzle.__rivalhub_legacy_migrations')::text AS archive");
  if (!relation.rows[0]?.archive) throw new Error("V3 migration lineage archive is missing; recovery refused.");
  const result = await pool.query<{ id: number; hash: string; when: string }>("SELECT id, hash, created_at::bigint::text AS \"when\" FROM drizzle.__rivalhub_legacy_migrations ORDER BY created_at, id");
  if (!result.rows.length) return undefined;
  const entries = result.rows.map(row => ({ id: row.id, hash: row.hash, when: Number(row.when) }));
  assertLegacyLineage(entries);
  return entries;
}

/** Restore only the verified archive into the empty table created by the v3 baseline. */
export async function restoreLegacyLineage(pool: Pick<Pool, "query">, entries: readonly LegacyLedgerEntry[] | undefined): Promise<void> {
  if (!entries) {
    if (await readLegacyLineage(pool)) throw new Error("Unexpected legacy lineage archive in restored database.");
    return;
  }
  assertLegacyLineage(entries);
  const relation = await pool.query<{ archive: string | null }>("SELECT to_regclass('drizzle.__rivalhub_legacy_migrations')::text AS archive");
  if (!relation.rows[0]?.archive) throw new Error("Restored baseline lacks legacy lineage archive.");
  const count = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM drizzle.__rivalhub_legacy_migrations");
  if (count.rows[0]?.count !== "0") throw new Error("Restored legacy lineage archive is not empty.");
  await pool.query("INSERT INTO drizzle.__rivalhub_legacy_migrations (id, hash, created_at) SELECT * FROM unnest($1::integer[], $2::text[], $3::bigint[])", [
    entries.map(entry => entry.id), entries.map(entry => entry.hash), entries.map(entry => entry.when),
  ]);
  const restored = await readLegacyLineage(pool);
  if (!restored || restored.length !== entries.length || restored.some((entry, index) =>
    entry.id !== entries[index]?.id || entry.hash !== entries[index]?.hash || entry.when !== entries[index]?.when)) {
    throw new Error("Restored legacy lineage archive differs from the backup manifest.");
  }
}

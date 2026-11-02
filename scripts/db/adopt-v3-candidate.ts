import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PoolClient } from "pg";
import { captureApplicationMigrationContract } from "./compare-migration-contract";
import { isMigrationLedgerPrefix, readMigrationLedger, type MigrationIdentity } from "./migration-ledger";

const root = resolve(process.cwd(), "drizzle/baseline-candidate");

/** Candidate-only local exercise. The caller must have stopped writers and all
 * migration runners; neither this lock nor a catalog snapshot is a global DDL mutex. */
export async function adoptLegacyCandidate(client: PoolClient): Promise<"adopted" | "already-adopted"> {
  const legacy = JSON.parse(readFileSync(resolve(root, "legacy-ledger.json"), "utf8")) as MigrationIdentity[];
  const expectedContract = JSON.parse(readFileSync(resolve(root, "legacy-contract.json"), "utf8")) as Record<string, string[]>;
  const baseline = readMigrationLedger(root);
  if (legacy.length !== 113 || baseline.length !== 1) throw new Error("Candidate lineage files are incomplete.");
  await client.query("SELECT pg_advisory_lock(hashtext('rivalhub.instance.install'))");
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("LOCK TABLE drizzle.__drizzle_migrations IN ACCESS EXCLUSIVE MODE");
    const result = await client.query<{ hash: string; when: string }>("SELECT hash, created_at::bigint::text AS \"when\" FROM drizzle.__drizzle_migrations ORDER BY created_at, id");
    const current = result.rows.map(row => ({ hash: row.hash, when: Number(row.when) }));
    const isLegacy = current.length === legacy.length && isMigrationLedgerPrefix(current, legacy);
    const isBaseline = current.length === 1 && isMigrationLedgerPrefix(current, baseline);
    if (!isLegacy && !isBaseline) throw new Error("Unknown or incomplete migration ledger; candidate adoption refused.");
    const contract = await captureApplicationMigrationContract(client);
    if (JSON.stringify(contract) !== JSON.stringify(expectedContract)) throw new Error("Application physical contract differs; candidate adoption refused.");
    const relation = await client.query<{ archive: string | null }>("SELECT to_regclass('drizzle.__rivalhub_legacy_migrations')::text AS archive");
    if (isBaseline) {
      if (!relation.rows[0]?.archive) throw new Error("Baseline has no archived legacy ledger; candidate adoption refused.");
      const archived = await client.query<{ hash: string; when: string }>("SELECT hash, created_at::bigint::text AS \"when\" FROM drizzle.__rivalhub_legacy_migrations ORDER BY created_at, id");
      const history = archived.rows.map(row => ({ hash: row.hash, when: Number(row.when) }));
      if (history.length !== legacy.length || !isMigrationLedgerPrefix(history, legacy)) throw new Error("Archived legacy ledger differs; candidate adoption refused.");
      await client.query("COMMIT");
      return "already-adopted";
    }
    if (relation.rows[0]?.archive) throw new Error("Unexpected pre-existing legacy archive; candidate adoption refused.");
    await client.query("CREATE TABLE drizzle.__rivalhub_legacy_migrations (id integer PRIMARY KEY, hash text NOT NULL, created_at bigint NOT NULL)");
    await client.query("REVOKE ALL ON TABLE drizzle.__rivalhub_legacy_migrations FROM PUBLIC, anon, authenticated");
    await client.query("INSERT INTO drizzle.__rivalhub_legacy_migrations (id, hash, created_at) SELECT id, hash, created_at FROM drizzle.__drizzle_migrations");
    await client.query("DELETE FROM drizzle.__drizzle_migrations");
    await client.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)", [baseline[0]!.hash, baseline[0]!.when]);
    await client.query("COMMIT");
    return "adopted";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('rivalhub.instance.install'))");
  }
}

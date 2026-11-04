import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { isMigrationLedgerPrefix, readMigrationLedger } from "./migration-ledger";

function stageMigrationPrefixes(migrations: string) {
  const journal = JSON.parse(readFileSync(join(migrations, "meta/_journal.json"), "utf8")) as {
    entries: Array<{ tag: string }>; [key: string]: unknown;
  };
  const boundaries = journal.entries.flatMap((entry, index) =>
    /ALTER\s+TYPE\b[\s\S]*?\bADD\s+VALUE\b/i.test(readFileSync(join(migrations, `${entry.tag}.sql`), "utf8"))
      ? [index + 1] : []);
  if (boundaries.at(-1) !== journal.entries.length) boundaries.push(journal.entries.length);
  const staging = mkdtempSync(join(tmpdir(), "rivalhub-migrations-"));
  try {
    const prefixes = boundaries.map((end) => {
      const prefix = join(staging, `prefix-${end}`);
      mkdirSync(join(prefix, "meta"), { recursive: true });
      const entries = journal.entries.slice(0, end);
      writeFileSync(join(prefix, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
      for (const entry of entries) copyFileSync(join(migrations, `${entry.tag}.sql`), join(prefix, `${entry.tag}.sql`));
      return prefix;
    });
    return { staging, prefixes };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

/** Keep original SQL hashes/ledger; commit enum additions before later migrations use them. */
export function runCanonicalMigrations(config: string, env: NodeJS.ProcessEnv, migrationsFolder = "drizzle/migrations"): void {
  const root = resolve(process.cwd());
  // drizzle-kit drops explicit SSL options for URL credentials. Use the same
  // node-postgres connection owner as runtime/preflight, preserving CA + hostname.
  const result = spawnSync(join(root, `node_modules/.bin/tsx${process.platform === "win32" ? ".cmd" : ""}`),
    ["scripts/db/canonical-migrate-cli.ts", resolve(root, config), resolve(migrationsFolder)],
    { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.signal || result.status !== 0) throw new Error("Canonical migration runner failed.");
}

/** Preview's checked-out connection uses the same transaction boundaries as CLI replay. */
export async function migrateCanonicalDatabase(database: NodePgDatabase, migrationsFolder: string): Promise<void> {
  // Drizzle uses the latest timestamp to decide what to skip. An unknown or
  // reordered ledger must never be treated as a successful migration.
  const expected = readMigrationLedger(resolve(migrationsFolder));
  const relation = await database.execute<{ ledger: string | null }>(sql`SELECT to_regclass('drizzle.__drizzle_migrations')::text AS ledger`);
  if (relation.rows[0]?.ledger) {
    const result = await database.execute<{ hash: string; when: string }>(sql`SELECT hash, created_at::bigint::text AS "when" FROM drizzle.__drizzle_migrations ORDER BY created_at`);
    const actual = result.rows.map(row => ({ hash: row.hash, when: Number(row.when) }));
    if (!isMigrationLedgerPrefix(actual, expected)) throw new Error("Drizzle migration ledger is not an exact prefix of the selected chain; refusing migration.");
  }
  const { staging, prefixes } = stageMigrationPrefixes(resolve(migrationsFolder));
  try {
    for (const prefix of prefixes) await migrate(database, { migrationsFolder: prefix });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

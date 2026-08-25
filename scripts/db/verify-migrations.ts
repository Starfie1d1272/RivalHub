import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { assertLocalDatabaseUrl } from "./local-environment";
import { assertStagingDatabaseUrl } from "./staging-environment";

interface MigrationJournalEntry {
  tag: string;
  when: number;
}

async function main(): Promise<void> {
  const target = process.env.RIVALHUB_DB_TARGET;
  const databaseUrl = databaseUrlFor(target, process.env.DATABASE_URL);
  const expected = readExpectedMigrations();
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: target === "staging" ? { rejectUnauthorized: false } : false,
    max: 1,
  });

  try {
    const result = await pool.query<{
      seasons_table: string | null;
      teams_table: string | null;
      ledger: Array<{ hash: string; created_at: string }>;
    }>(`
      SELECT
        to_regclass('public.seasons')::text AS seasons_table,
        to_regclass('public.teams')::text AS teams_table,
        COALESCE(
          (SELECT json_agg(row_to_json(m) ORDER BY m.created_at)
           FROM (SELECT hash, created_at FROM drizzle.__drizzle_migrations) AS m),
          '[]'::json
        ) AS ledger
    `);
    const facts = result.rows[0];
    if (!facts?.seasons_table || !facts.teams_table) {
      throw new Error("Drizzle baseline 关键业务表缺失。");
    }

    const actual = facts.ledger.map((entry) => ({
      hash: entry.hash,
      when: Number(entry.created_at),
    }));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error("Drizzle migration ledger 与 active migration chain 不完全一致。");
    }

    console.log(`Migration verification passed for ${target}: ${expected.length} active migrations.`);
  } finally {
    await pool.end();
  }
}

function databaseUrlFor(target: string | undefined, value: string | undefined): string {
  if (target === "local") return assertLocalDatabaseUrl(value);
  if (target === "staging") return assertStagingDatabaseUrl(value);
  throw new Error("Migration verification 目标必须由受保护命令声明为 local 或 staging。");
}

function readExpectedMigrations(): Array<{ hash: string; when: number }> {
  const migrationsDirectory = resolve(process.cwd(), "drizzle/migrations");
  const journal = JSON.parse(
    readFileSync(resolve(migrationsDirectory, "meta/_journal.json"), "utf8"),
  ) as { entries: MigrationJournalEntry[] };

  return journal.entries.map((entry) => ({
    hash: createHash("sha256")
      .update(readFileSync(resolve(migrationsDirectory, `${entry.tag}.sql`), "utf8"))
      .digest("hex"),
    when: entry.when,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

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
  const { staging, prefixes } = stageMigrationPrefixes(resolve(migrationsFolder));
  try {
    for (const prefix of prefixes) {
      const stagedConfig = join(staging, "config.ts");
      writeFileSync(stagedConfig, `import config from ${JSON.stringify(resolve(root, config))};\nexport default { ...config, out: ${JSON.stringify(prefix)} };\n`);
      const result = spawnSync(join(root, `node_modules/.bin/drizzle-kit${process.platform === "win32" ? ".cmd" : ""}`),
        ["migrate", `--config=${stagedConfig}`], { cwd: root, env, stdio: "inherit" });
      if (result.error) throw result.error;
      if (result.signal || result.status !== 0) throw new Error(`Canonical migration ${prefix.split(/[\\/]/).at(-1)} failed.`);
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** Preview's checked-out connection uses the same transaction boundaries as CLI replay. */
export async function migrateCanonicalDatabase(database: NodePgDatabase, migrationsFolder: string): Promise<void> {
  const { staging, prefixes } = stageMigrationPrefixes(resolve(migrationsFolder));
  try {
    for (const prefix of prefixes) await migrate(database, { migrationsFolder: prefix });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

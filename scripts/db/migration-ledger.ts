import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface MigrationIdentity { hash: string; when: number; }
export interface TaggedMigrationIdentity extends MigrationIdentity { tag: string; }

export function isMigrationLedgerPrefix(actual: readonly MigrationIdentity[], expected: readonly MigrationIdentity[]): boolean {
  return actual.length <= expected.length && actual.every((item, index) =>
    item.hash === expected[index]?.hash && item.when === expected[index]?.when);
}

/** Read the original SQL bytes: Drizzle's ledger identifies content, not filenames alone. */
export function readMigrationLedger(directory = resolve(process.cwd(), "drizzle/migrations")): TaggedMigrationIdentity[] {
  const journal = JSON.parse(readFileSync(resolve(directory, "meta/_journal.json"), "utf8")) as {
    entries: Array<{ tag: string; when: number }>;
  };
  return journal.entries.map(({ tag, when }) => ({
    tag,
    hash: createHash("sha256").update(readFileSync(resolve(directory, `${tag}.sql`), "utf8")).digest("hex"),
    when,
  }));
}

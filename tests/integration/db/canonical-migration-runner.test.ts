import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCanonicalMigrations } from "../../../scripts/db/canonical-migrate";
import { localDatabaseUrl } from "./harness/database";
import { withScratchDatabase } from "./harness/migration-replay";

describe("canonical migration CLI", () => {
  it("commits enum additions, resumes the exact ledger and preserves SQL hashes", async () => {
    await withScratchDatabase("canonical_runner", async client => {
      const root = mkdtempSync(join(tmpdir(), "rivalhub-runner-test-"));
      try {
        mkdirSync(join(root, "meta"));
        const databaseUrl = new URL(localDatabaseUrl());
        databaseUrl.pathname = `/${client.database}`;
        const config = join(root, "config.ts");
        writeFileSync(config, `export default ${JSON.stringify({ dialect: "postgresql", dbCredentials: { url: databaseUrl.toString() } })};`);
        const sql = [
          `CREATE TYPE runner_state AS ENUM ('pending'); CREATE TABLE runner_facts (state runner_state NOT NULL);`,
          `ALTER TYPE runner_state ADD VALUE 'ready';`,
          `INSERT INTO runner_facts VALUES ('ready');`,
        ];
        const entries = sql.map((source, idx) => {
          const tag = `000${idx}_runner`;
          writeFileSync(join(root, `${tag}.sql`), source);
          return { idx, version: "7", when: 1_700_000_000_000 + idx, tag, breakpoints: true };
        });
        const journal = (count: number) => writeFileSync(join(root, "meta/_journal.json"), JSON.stringify({ version: "7", dialect: "postgresql", entries: entries.slice(0, count) }));
        journal(2);
        runCanonicalMigrations(config, process.env, root);
        expect((await client.query("SELECT * FROM drizzle.__drizzle_migrations")).rowCount).toBe(2);
        journal(3);
        runCanonicalMigrations(config, process.env, root);
        runCanonicalMigrations(config, process.env, root);
        expect((await client.query("SELECT state FROM runner_facts")).rows).toEqual([{ state: "ready" }]);
        const ledger = await client.query("SELECT hash, created_at::text AS time FROM drizzle.__drizzle_migrations ORDER BY created_at");
        expect(ledger.rows).toEqual(sql.map((source, idx) => ({ hash: createHash("sha256").update(source).digest("hex"), time: String(entries[idx]!.when) })));
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }, 60_000);
});

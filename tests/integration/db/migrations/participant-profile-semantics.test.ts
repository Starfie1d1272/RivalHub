import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { migrationFiles, replayMigration, withScratchDatabase } from "../harness/migration-replay";

const TERMINAL_MIGRATION = "0026_certain_annihilus.sql";

function preProfileSemanticsMigrations(): string[] {
  return migrationFiles((name) => /^00(?:0[0-9]|1[0-9]|2[0-5])_.*\.sql$/.test(name));
}

async function replayBeforeTerminal(client: Client): Promise<void> {
  for (const migration of preProfileSemanticsMigrations()) await replayMigration(client, migration);
}

describe("participant profile semantics migration", () => {
  it("preserves canonical facts while removing duplicate Perfect identity and role taxonomy", async () => {
    await withScratchDatabase("rivalhub_0026_participant_profile", async (client) => {
      await replayBeforeTerminal(client);
      const userId = randomUUID();
      await client.query(
        `INSERT INTO users (id, email, perfect_name, perfect_id)
         VALUES ($1, $2, 'Canonical Nick', 'duplicate-id')`,
        [userId, `profile-semantics-${userId}@local.test`],
      );
      await client.query(
        `INSERT INTO user_competitive_roles (user_id, role, is_primary)
         VALUES ($1, 'igl', true)`,
        [userId],
      );

      await replayMigration(client, TERMINAL_MIGRATION);

      const [columns, roles, enumValues, index] = await Promise.all([
        client.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'perfect_id'"),
        client.query<{ role: string; is_primary: boolean }>("SELECT role::text, is_primary FROM user_competitive_roles WHERE user_id = $1", [userId]),
        client.query<{ enumlabel: string }>("SELECT enumlabel FROM pg_enum WHERE enumtypid = 'public.cs2_role'::regtype ORDER BY enumsortorder"),
        client.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'users_perfect_id_normalized_unique'"),
      ]);
      expect(columns.rows).toEqual([]);
      expect(index.rows).toEqual([]);
      expect(roles.rows).toEqual([{ role: "igl", is_primary: true }]);
      expect(enumValues.rows.map((row) => row.enumlabel)).toEqual(["igl", "awper", "opener", "closer", "anchor"]);
    });
  });

  it("fails closed before destructive DDL when a legacy role has no canonical meaning", async () => {
    await withScratchDatabase("rivalhub_0026_invalid_role", async (client) => {
      await replayBeforeTerminal(client);
      const userId = randomUUID();
      await client.query("INSERT INTO users (id, email) VALUES ($1, $2)", [userId, `invalid-role-${userId}@local.test`]);
      await client.query("INSERT INTO user_competitive_roles (user_id, role) VALUES ($1, 'support')", [userId]);

      const source = readFileSync(join(process.cwd(), "drizzle/migrations", TERMINAL_MIGRATION), "utf8");
      await client.query("BEGIN");
      let failedClosed = false;
      try {
        await client.query(source);
        await client.query("COMMIT");
      } catch (error) {
        failedClosed = true;
        await client.query("ROLLBACK");
        expect(error instanceof Error ? error.message : String(error)).toContain("non-canonical cs2 role");
      }
      expect(failedClosed).toBe(true);

      const [column, roles] = await Promise.all([
        client.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'perfect_id'"),
        client.query<{ role: string }>("SELECT role::text FROM user_competitive_roles WHERE user_id = $1", [userId]),
      ]);
      expect(column.rows).toHaveLength(1);
      expect(roles.rows).toEqual([{ role: "support" }]);
    });
  });
});

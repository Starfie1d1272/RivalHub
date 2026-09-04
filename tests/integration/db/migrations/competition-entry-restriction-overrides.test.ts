import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { verifyDatabaseAccessMatrix } from "../../../../scripts/db/access-matrix";
import { capturePostgresError } from "../harness/database";
import { migrationFiles, replayMigration, withScratchDatabase } from "../harness/migration-replay";

const TERMINAL_MIGRATION = "0035_colorful_black_widow.sql";

describe("qualification restriction override migration", () => {
  it("creates a revision-scoped server-only ledger with deny-by-default access", async () => {
    await withScratchDatabase("rivalhub_qualification_override", async (client: Client) => {
      const migrations = migrationFiles((name) => /^\d{4}_.*\.sql$/.test(name));
      for (const migration of migrations.filter((name) => name < TERMINAL_MIGRATION)) {
        await replayMigration(client, migration);
      }
      await replayMigration(client, TERMINAL_MIGRATION);

      await verifyDatabaseAccessMatrix(client, "0035 qualification restriction override replay");

      const table = await client.query<{ relrowsecurity: boolean }>(
        `SELECT relrowsecurity FROM pg_class
         WHERE oid = 'public.competition_entry_restriction_overrides'::regclass`,
      );
      expect(table.rows[0]?.relrowsecurity).toBe(true);
      const indexes = await client.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'competition_entry_restriction_overrides'`,
      );
      expect(indexes.rows.map((row) => row.indexname)).toEqual(expect.arrayContaining([
        "competition_entry_restriction_overrides_active_unique",
        "competition_entry_restriction_overrides_entry_idx",
        "competition_entry_restriction_overrides_competition_idx",
      ]));

      await client.query("BEGIN");
      for (const role of ["anon", "authenticated"] as const) {
        await client.query(`SET LOCAL ROLE ${role}`);
        const denied = await capturePostgresError(client, () => client.query(
          "SELECT id FROM competition_entry_restriction_overrides",
        ));
        expect(denied).toMatchObject({ code: "42501" });
        await client.query("RESET ROLE");
      }
      await client.query("COMMIT");
    });
  });
});

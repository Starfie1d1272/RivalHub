import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { verifyDatabaseAccessMatrix } from "../../../../scripts/db/access-matrix";
import { capturePostgresError } from "../harness/database";
import { migrationFiles, replayMigration, withScratchDatabase } from "../harness/migration-replay";

const TARGET_MIGRATION = "0041_spicy_loners.sql";

describe("conversion policies migration", () => {
  it("creates server-only conversion_policies table with RLS, denies anon/authenticated access, and seeds lead-approved 2026.09 policy", async () => {
    await withScratchDatabase("rivalhub_conversion_policies", async (client: Client) => {
      const migrations = migrationFiles((name) => /^\d{4}_.*\.sql$/.test(name));
      for (const migration of migrations.filter((name) => name <= TARGET_MIGRATION)) {
        await replayMigration(client, migration);
      }

      await verifyDatabaseAccessMatrix(client, "0038 conversion policies replay");

      const table = await client.query<{ relrowsecurity: boolean }>(
        `SELECT relrowsecurity FROM pg_class
         WHERE oid = 'public.conversion_policies'::regclass`,
      );
      expect(table.rows[0]?.relrowsecurity).toBe(true);

      const indexes = await client.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'conversion_policies'`,
      );
      const indexNames = indexes.rows.map((r) => r.indexname);
      expect(indexNames).toContain("conversion_policies_source_target_version_unique");
      expect(indexNames).toContain("conversion_policies_one_current_per_pair");

      const seeded = await client.query<{
        id: string;
        source_platform: string;
        target_platform: string;
        version: string;
        status: string;
        is_current: boolean;
        mapping: {
          relativeSeasonAlignment: boolean;
          starSegments: unknown[];
          belowSRankMap: Record<string, string>;
        };
      }>(
        `SELECT id, source_platform, target_platform, version, status, is_current, mapping
         FROM conversion_policies
         WHERE source_platform = 'fivee' AND target_platform = 'perfect_world' AND version = '2026.09'`,
      );
      expect(seeded.rows).toHaveLength(1);
      const policy = seeded.rows[0]!;
      expect(policy.status).toBe("approved");
      expect(policy.is_current).toBe(true);
      expect(policy.mapping.relativeSeasonAlignment).toBe(true);
      expect(policy.mapping.starSegments).toHaveLength(5);
      expect(policy.mapping.belowSRankMap["A"]).toBe("B++");

      await client.query("BEGIN");
      try {
        for (const role of ["anon", "authenticated"] as const) {
          await client.query(`SET LOCAL ROLE ${role}`);
          const deniedSelect = await capturePostgresError(client, () =>
            client.query("SELECT id FROM conversion_policies"),
          );
          expect(deniedSelect).toMatchObject({ code: "42501" });
          await client.query("RESET ROLE");
        }

        const duplicateVersionError = await capturePostgresError(client, () =>
          client.query(
            `INSERT INTO conversion_policies (source_platform, target_platform, version, status, mapping)
             VALUES ('fivee', 'perfect_world', '2026.09', 'draft', '{}'::jsonb)`,
          ),
        );
        expect(duplicateVersionError).toMatchObject({ code: "23505" });

        const duplicateCurrentError = await capturePostgresError(client, () =>
          client.query(
            `INSERT INTO conversion_policies (source_platform, target_platform, version, status, is_current, mapping)
             VALUES ('fivee', 'perfect_world', '2026.10', 'approved', true, '{}'::jsonb)`,
          ),
        );
        expect(duplicateCurrentError).toMatchObject({ code: "23505" });

        const unapprovedCurrentError = await capturePostgresError(client, () =>
          client.query(
            `INSERT INTO conversion_policies (source_platform, target_platform, version, status, is_current, mapping)
             VALUES ('fivee', 'perfect_world', '2026.11', 'draft', true, '{}'::jsonb)`,
          ),
        );
        expect(unapprovedCurrentError).toMatchObject({ code: "23514" });
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });
});

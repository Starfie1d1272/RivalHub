import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { capturePostgresError } from "../harness/database";
import { migrationFiles, replayMigration, withScratchDatabase } from "../harness/migration-replay";
import { readExpectedMigrations } from "../../../../scripts/db/production-preflight";
import { prepareTargetForDataImport } from "../../../../scripts/db/recovery/restore";
import { verifyRecoveryDatabase } from "../../../../scripts/db/recovery/verify";

const TARGET_MIGRATION = "0042_identity_foundation.sql";

describe("recovery restore seed collision and auth invariant regression", () => {
  it("prevents duplicate key collision via generic pre-data-import preparation and enforces auth invariant", async () => {
    await withScratchDatabase("rivalhub_recovery_restore", async (client: Client) => {
      // 1. Replay migrations up to TARGET_MIGRATION, which includes 0038_conversion_policies.sql
      const migrations = migrationFiles((name) => /^\d{4}_.*\.sql$/.test(name));
      for (const migration of migrations.filter((name) => name <= TARGET_MIGRATION)) {
        await replayMigration(client, migration);
      }

      // 2. Ensure auth schema and tables exist for auth invariant testing
      await client.query(`CREATE SCHEMA IF NOT EXISTS auth`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS auth.users (
          id uuid PRIMARY KEY,
          email text
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS auth.schema_migrations (
          version text PRIMARY KEY
        )
      `);
      await client.query(`INSERT INTO auth.schema_migrations (version) VALUES ('20240101000000') ON CONFLICT DO NOTHING`);

      // Ensure drizzle schema and ledger exist with valid prefix up to TARGET_MIGRATION
      await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
          id serial PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        )
      `);
      const expected = readExpectedMigrations();
      const targetTag = TARGET_MIGRATION.replace(/\.sql$/, "");
      const targetIndex = expected.findIndex((e) => e.tag === targetTag);
      const prefix = expected.slice(0, targetIndex + 1);
      for (const item of prefix) {
        await client.query(
          `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
          [item.hash, item.when],
        );
      }
      const terminalItem = prefix.at(-1);
      if (!terminalItem) throw new Error("Expected migration prefix cannot be empty");
      const terminalExpectedMigration = {
        terminalHash: terminalItem.hash,
        terminalTag: terminalItem.tag,
        terminalWhen: terminalItem.when,
      };

      // 3. Verify migration 0038 created the seed row
      const initialSeed = await client.query<{ id: string; version: string; source_note: string }>(
        `SELECT id, version, source_note FROM public.conversion_policies
         WHERE source_platform = 'fivee' AND target_platform = 'perfect_world' AND version = '2026.09'`,
      );
      expect(initialSeed.rows).toHaveLength(1);
      const originalSeedId = initialSeed.rows[0]?.id;

      // 4. A production snapshot contains the production row for the same (source_platform, target_platform, version)
      // Without preparation, attempting to insert/copy the snapshot row collisions with duplicate key (23505)
      const snapshotRow = {
        id: "99999999-9999-4999-8999-999999999999",
        source_platform: "fivee",
        target_platform: "perfect_world",
        version: "2026.09",
        status: "approved",
        mapping: JSON.stringify({ snapshotTruth: true }),
        is_current: true,
        source_note: "Snapshot canonical data truth",
      };

      await client.query("BEGIN");
      try {
        const collisionError = await capturePostgresError(client, () =>
          client.query(
            `INSERT INTO public.conversion_policies (id, source_platform, target_platform, version, status, mapping, is_current, source_note)
             VALUES ($1, $2, $3, $4, $5::public.conversion_policy_status, $6::jsonb, $7, $8)`,
            [
              snapshotRow.id,
              snapshotRow.source_platform,
              snapshotRow.target_platform,
              snapshotRow.version,
              snapshotRow.status,
              snapshotRow.mapping,
              snapshotRow.is_current,
              snapshotRow.source_note,
            ],
          ),
        );
        expect(collisionError).toMatchObject({ code: "23505" });
      } finally {
        await client.query("ROLLBACK");
      }

      // 5. Run generic prepareTargetForDataImport on the disposable target
      const truncatedTables = await prepareTargetForDataImport(client);
      expect(truncatedTables).toContain("public.conversion_policies");

      // Verify migration metadata was preserved
      const ledger = await client.query("SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations");
      expect(Number(ledger.rows[0]?.count)).toBeGreaterThan(0);
      const authMigrations = await client.query("SELECT count(*)::text AS count FROM auth.schema_migrations");
      expect(Number(authMigrations.rows[0]?.count)).toBe(1);

      // Verify application tables were emptied
      const emptyCheck = await client.query("SELECT count(*)::text AS count FROM public.conversion_policies");
      expect(emptyCheck.rows[0]?.count).toBe("0");

      // 6. Import snapshot data under session_replication_role = replica
      await client.query("SET session_replication_role = 'replica'");
      try {
        await client.query(
          `INSERT INTO public.conversion_policies (id, source_platform, target_platform, version, status, mapping, is_current, source_note)
           VALUES ($1, $2, $3, $4, $5::public.conversion_policy_status, $6::jsonb, $7, $8)`,
          [
            snapshotRow.id,
            snapshotRow.source_platform,
            snapshotRow.target_platform,
            snapshotRow.version,
            snapshotRow.status,
            snapshotRow.mapping,
            snapshotRow.is_current,
            snapshotRow.source_note,
          ],
        );
      } finally {
        await client.query("SET session_replication_role = 'origin'");
      }

      // Verify no duplicate key, and final data is identical to snapshot truth
      const restored = await client.query<{ id: string; version: string; source_note: string }>(
        `SELECT id, version, source_note FROM public.conversion_policies
         WHERE source_platform = 'fivee' AND target_platform = 'perfect_world' AND version = '2026.09'`,
      );
      expect(restored.rows).toHaveLength(1);
      expect(restored.rows[0]?.id).toBe(snapshotRow.id);
      expect(restored.rows[0]?.id).not.toBe(originalSeedId);
      expect(restored.rows[0]?.source_note).toBe(snapshotRow.source_note);

      // 7. Test Auth restore invariant:
      // A) Active public.users row with auth_id not existing in auth.users must fail closed
      const danglingAuthId = "88888888-8888-4888-8888-888888888888";
      const userId = "77777777-7777-4777-8777-777777777777";
      await client.query(
        `INSERT INTO public.users (id, auth_id, email, status)
         VALUES ($1, $2, $3, 'active')`,
        [userId, danglingAuthId, "dangling@example.test"],
      );

      await expect(verifyRecoveryDatabase(client, { expectedMigration: terminalExpectedMigration })).rejects.toThrow(
        /Recovery invariant failed: auth\.active_users_auth_id_mapping/,
      );

      // B) Once auth.users has the corresponding auth identity, verification succeeds
      await client.query(
        `INSERT INTO auth.users (id, email) VALUES ($1, $2)`,
        [danglingAuthId, "dangling@example.test"],
      );

      // Add a primary user identity so identity invariants also pass
      await client.query(
        `INSERT INTO public.user_identities (id, user_id, kind, provider, provider_subject, normalized_value, provenance, status, is_primary)
         VALUES ('66666666-6666-4666-8666-666666666666', $1, 'email', 'email', 'dangling@example.test', 'dangling@example.test', 'admin_migration', 'active', true)`,
        [userId],
      );

      const verificationResult = await verifyRecoveryDatabase(client, { expectedMigration: terminalExpectedMigration });
      expect(verificationResult.invariantCount).toBeGreaterThan(0);
    });
  });
});

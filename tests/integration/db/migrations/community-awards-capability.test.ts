import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { migrationFiles, replayMigration, withScratchDatabase } from "../harness/migration-replay";

const TARGET_MIGRATION = "0039_clumsy_doctor_octopus.sql";

describe("community awards capability migration", () => {
  it("backfills existing seasons and defaults new seasons to enabled", async () => {
    await withScratchDatabase("rivalhub_0039_community_awards", async (client: Client) => {
      const migrations = migrationFiles((name) => /^\d{4}_.*\.sql$/.test(name));
      for (const migration of migrations.filter((name) => name < TARGET_MIGRATION)) {
        await replayMigration(client, migration);
      }

      const legacySeasonId = randomUUID();
      await client.query(
        "INSERT INTO seasons (id, slug, name, kind) VALUES ($1, $2, 'Legacy season', 'custom')",
        [legacySeasonId, `legacy-community-awards-${legacySeasonId}`],
      );

      await replayMigration(client, TARGET_MIGRATION);

      const existing = await client.query<{ has_community_awards: boolean }>(
        "SELECT has_community_awards FROM seasons WHERE id = $1",
        [legacySeasonId],
      );
      expect(existing.rows).toEqual([{ has_community_awards: true }]);

      const newSeasonId = randomUUID();
      await client.query(
        "INSERT INTO seasons (id, slug, name, kind) VALUES ($1, $2, 'New season', 'custom')",
        [newSeasonId, `new-community-awards-${newSeasonId}`],
      );
      const created = await client.query<{ has_community_awards: boolean }>(
        "SELECT has_community_awards FROM seasons WHERE id = $1",
        [newSeasonId],
      );
      expect(created.rows).toEqual([{ has_community_awards: true }]);

      await client.query("UPDATE seasons SET has_community_awards = false WHERE id = $1", [legacySeasonId]);
      const explicitlyDisabled = await client.query<{ has_community_awards: boolean }>(
        "SELECT has_community_awards FROM seasons WHERE id = $1",
        [legacySeasonId],
      );
      expect(explicitlyDisabled.rows).toEqual([{ has_community_awards: false }]);
    });
  });
});

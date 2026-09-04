import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { verifyDatabaseAccessMatrix } from "../../../../scripts/db/access-matrix";
import { capturePostgresError } from "../harness/database";
import { migrationFiles, replayMigration, withScratchDatabase } from "../harness/migration-replay";

const TERMINAL_MIGRATION = "0035_colorful_black_widow.sql";

describe("database access boundary migration", () => {
  it("replays the terminal contract, keeps the trusted server path, and denies anon/authenticated CRUD", async () => {
    await withScratchDatabase("rivalhub_access_boundary", async (client: Client) => {
      const migrations = migrationFiles((name) => /^\d{4}_.*\.sql$/.test(name));
      for (const migration of migrations.filter((name) => name < TERMINAL_MIGRATION)) {
        await replayMigration(client, migration);
      }

      const seasonId = randomUUID();
      const probeSeasonId = randomUUID();
      await client.query(
        `INSERT INTO seasons (id, slug, name, kind, status)
         VALUES ($1, $2, 'Access boundary fixture', 'custom', 'draft'),
                ($3, $4, 'Access boundary probe', 'custom', 'draft')`,
        [seasonId, `access-boundary-${seasonId}`, probeSeasonId, `access-boundary-probe-${probeSeasonId}`],
      );
      await client.query(
        `INSERT INTO competition_bracket_states (competition_id, data)
         VALUES ($1, $2::jsonb)`,
        [seasonId, JSON.stringify({ stage: [] })],
      );

      await replayMigration(client, TERMINAL_MIGRATION);
      for (const migration of migrations.filter((name) => name > TERMINAL_MIGRATION)) {
        await replayMigration(client, migration);
      }
      await verifyDatabaseAccessMatrix(client, "0035 migration replay");

      const trustedRead = await client.query<{ data: unknown }>(
        "SELECT data FROM competition_bracket_states WHERE competition_id = $1",
        [seasonId],
      );
      expect(trustedRead.rows[0]?.data).toEqual({ stage: [] });

      await client.query(
        "UPDATE competition_bracket_states SET data = $2::jsonb WHERE competition_id = $1",
        [seasonId, JSON.stringify({ stage: [], trustedServerWrite: true })],
      );
      const trustedUpdate = await client.query<{ data: unknown }>(
        "SELECT data FROM competition_bracket_states WHERE competition_id = $1",
        [seasonId],
      );
      expect(trustedUpdate.rows[0]?.data).toEqual({ stage: [], trustedServerWrite: true });

      const inserted = await client.query<{ competition_id: string }>(
        `INSERT INTO competition_bracket_states (competition_id, data)
         VALUES ($1, $2::jsonb)
         RETURNING competition_id`,
        [probeSeasonId, JSON.stringify({ stage: [], trustedServerInsert: true })],
      );
      expect(inserted.rows[0]?.competition_id).toBe(probeSeasonId);

      await client.query("BEGIN");
      for (const role of ["anon", "authenticated"] as const) {
        await client.query(`SET LOCAL ROLE ${role}`);
        const deniedSelect = await capturePostgresError(client, () =>
          client.query(
            "SELECT competition_id FROM competition_bracket_states WHERE competition_id = $1",
            [seasonId],
          ),
        );
        expect(deniedSelect).toMatchObject({ code: "42501" });

        const deniedInsert = await capturePostgresError(client, () =>
          client.query(
            `INSERT INTO competition_bracket_states (competition_id, data)
             VALUES ($1, $2::jsonb)`,
            [randomUUID(), JSON.stringify({ stage: [] })],
          ),
        );
        expect(deniedInsert).toMatchObject({ code: "42501" });

        const deniedUpdate = await capturePostgresError(client, () =>
          client.query(
            "UPDATE competition_bracket_states SET data = data WHERE competition_id = $1",
            [seasonId],
          ),
        );
        expect(deniedUpdate).toMatchObject({ code: "42501" });

        const deniedDelete = await capturePostgresError(client, () =>
          client.query(
            "DELETE FROM competition_bracket_states WHERE competition_id = $1",
            [probeSeasonId],
          ),
        );
        expect(deniedDelete).toMatchObject({ code: "42501" });
        await client.query("RESET ROLE");
      }
      await client.query("COMMIT");

      await client.query(
        "DELETE FROM competition_bracket_states WHERE competition_id = $1",
        [probeSeasonId],
      );
      await client.query("DELETE FROM seasons WHERE id IN ($1, $2)", [seasonId, probeSeasonId]);
    });
  });
});

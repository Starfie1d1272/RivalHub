import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { migrationFiles, replayMigration, withScratchDatabase } from "../harness/migration-replay";

describe("competition bracket state migration", () => {
  it("backfills non-null legacy state, removes the old owner, and preserves prior Team/Entry constraints", async () => {
    await withScratchDatabase("rivalhub_0022", async (client: Client) => {
      const migrations = migrationFiles((name) => /^\d{4}_.*\.sql$/.test(name));
      const terminal = migrations.find((name) => name.startsWith("0022_"));
      if (!terminal) throw new Error("找不到 0022 bracket state migration。");

      for (const migration of migrations.filter((name) => name < terminal)) {
        await replayMigration(client, migration);
      }

      const seasonId = randomUUID();
      const emptySeasonId = randomUUID();
      const updatedAt = new Date("2026-08-31T07:00:00.000Z");
      const legacyState = {
        stage: [{ id: 1, name: "淘汰赛", type: "single_elimination" }],
        match: [],
        match_game: [],
        participant: [{ id: 0, name: "Alpha" }],
        group: [],
        round: [],
      };

      await client.query(
        `INSERT INTO seasons (id, slug, name, kind, bracket_data, updated_at)
         VALUES ($1, $2, 'Bracket fixture', 'custom', $3::json, $4),
                ($5, $6, 'Empty bracket fixture', 'custom', NULL, $4)`,
        [seasonId, `replay-bracket-${seasonId}`, JSON.stringify(legacyState), updatedAt, emptySeasonId, `replay-empty-bracket-${emptySeasonId}`],
      );

      await replayMigration(client, terminal);

      const states = await client.query<{ competition_id: string; data: unknown; updated_at: Date }>(
        "SELECT competition_id, data, updated_at FROM competition_bracket_states ORDER BY competition_id",
      );
      expect(states.rows).toHaveLength(1);
      expect(states.rows[0]?.competition_id).toBe(seasonId);
      expect(states.rows[0]?.data).toEqual(legacyState);
      expect(new Date(states.rows[0]!.updated_at).getTime()).toBe(updatedAt.getTime());

      const oldColumn = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM information_schema.columns
         WHERE table_name = 'seasons' AND column_name = 'bracket_data'`,
      );
      expect(oldColumn.rows[0]?.count).toBe("0");

      const columns = await client.query<{ column_name: string; data_type: string; is_nullable: string }>(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_name = 'competition_bracket_states'
         ORDER BY ordinal_position`,
      );
      expect(columns.rows).toEqual([
        { column_name: "competition_id", data_type: "uuid", is_nullable: "NO" },
        { column_name: "data", data_type: "jsonb", is_nullable: "NO" },
        { column_name: "updated_at", data_type: "timestamp with time zone", is_nullable: "NO" },
      ]);

      const foreignKey = await client.query<{ constraint_type: string; foreign_table_name: string; foreign_column_name: string }>(
        `SELECT tc.constraint_type, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name
         WHERE tc.table_name = 'competition_bracket_states'
           AND tc.constraint_type = 'FOREIGN KEY'`,
      );
      expect(foreignKey.rows).toEqual([{
        constraint_type: "FOREIGN KEY",
        foreign_table_name: "seasons",
        foreign_column_name: "id",
      }]);

      const preservedConstraints = await client.query<{ conname: string; condeferrable: boolean; condeferred: boolean }>(
        `SELECT conname, condeferrable, condeferred
         FROM pg_constraint
         WHERE conname IN (
           'competition_entries_current_roster_revision_scope_fk',
           'competition_entries_approved_roster_revision_scope_fk'
         )
         ORDER BY conname`,
      );
      expect(preservedConstraints.rows).toEqual([
        {
          conname: "competition_entries_approved_roster_revision_scope_fk",
          condeferrable: true,
          condeferred: true,
        },
        {
          conname: "competition_entries_current_roster_revision_scope_fk",
          condeferrable: true,
          condeferred: true,
        },
      ]);
    });
  });
});

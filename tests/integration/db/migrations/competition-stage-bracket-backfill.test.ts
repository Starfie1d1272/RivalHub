import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { migrationFiles, replayMigration, withScratchDatabase } from "../harness/migration-replay";

const TARGET_MIGRATION = "0048_same_epoch.sql";
const HISTORICAL_PARTICIPANTS = Array.from({ length: 8 }, (_, index) => ({
  id: index + 1,
  name: `Historical entrant ${index + 1}`,
}));
const HISTORICAL_MATCHUPS: ReadonlyArray<readonly [number, number]> = [
  [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 1],
  [1, 3], [2, 4], [3, 5], [4, 6], [5, 7], [6, 8],
];

async function replayBeforeTarget(client: Client): Promise<void> {
  for (const migration of migrationFiles((name) => name.endsWith(".sql") && name < TARGET_MIGRATION)) {
    await replayMigration(client, migration);
  }
}

describe("2026 Rivals stage-scoped bracket backfill", () => {
  it("migrates the complete historical playoff fixture into the stage owner", async () => {
    await withScratchDatabase("rivalhub_0048_rivals_backfill", async (client) => {
      await replayBeforeTarget(client);

      const seasonId = randomUUID();
      const userIds = HISTORICAL_PARTICIPANTS.map(() => randomUUID());
      const entryIds = HISTORICAL_PARTICIPANTS.map(() => randomUUID());
      const revisionIds = HISTORICAL_PARTICIPANTS.map(() => randomUUID());
      const updatedAt = "2026-09-09T12:00:00.000Z";
      const sourceData = {
        stage: [],
        match: HISTORICAL_MATCHUPS.map(([opponent1, opponent2], index) => ({
          id: `historical-playoff-${index + 1}`,
          opponent1: { id: opponent1 },
          opponent2: { id: opponent2 },
        })),
        match_game: [],
        participant: HISTORICAL_PARTICIPANTS,
        group: [],
        round: [],
      };

      await client.query("BEGIN");
      try {
        await client.query(
          "INSERT INTO seasons (id, slug, name, kind, status) VALUES ($1, '2026-nju-rivals', 'NJU Rivals 2026', 'Rivals', 'finished')",
          [seasonId],
        );

        for (const [index, participant] of HISTORICAL_PARTICIPANTS.entries()) {
          await client.query("INSERT INTO users (id, email) VALUES ($1, $2)", [
            userIds[index],
            `historical-rivals-${participant.id}@local.test`,
          ]);
          await client.query(
            `INSERT INTO competition_entries (
               id, competition_id, source, name, representative_user_id,
               current_roster_revision_id, approved_roster_revision_id, registration_status
             ) VALUES ($1, $2, 'event_native', $3, $4, $5, $5, 'approved')`,
            [entryIds[index], seasonId, participant.name, userIds[index], revisionIds[index]],
          );
          await client.query(
            `INSERT INTO competition_entry_representative_changes (entry_id, from_user_id, to_user_id, changed_by_actor_id)
             VALUES ($1, NULL, $2, '0048-backfill-test')`,
            [entryIds[index], userIds[index]],
          );
          await client.query(
            `INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by, approved_at)
             VALUES ($1, $2, 1, 'approved', '0048-backfill-test', now())`,
            [revisionIds[index], entryIds[index]],
          );
        }

        for (const [index, [opponent1, opponent2]] of HISTORICAL_MATCHUPS.entries()) {
          await client.query(
            `INSERT INTO matches (id, season_id, entry_a_id, entry_b_id, stage, bracket_node_id)
             VALUES ($1, $2, $3, $4, 'playoff', $5)`,
            [randomUUID(), seasonId, entryIds[opponent1 - 1], entryIds[opponent2 - 1], `historical-playoff-${index + 1}`],
          );
        }

        await client.query(
          "INSERT INTO competition_bracket_states (competition_id, data, updated_at) VALUES ($1, $2::jsonb, $3)",
          [seasonId, JSON.stringify(sourceData), updatedAt],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }

      await replayMigration(client, TARGET_MIGRATION);

      const stageState = await client.query<{ competition_id: string; stage_key: string; data: unknown; updated_at: Date }>(
        "SELECT competition_id, stage_key, data, updated_at FROM competition_stage_bracket_states",
      );
      expect(stageState.rows).toHaveLength(1);
      expect(stageState.rows[0]?.competition_id).toBe(seasonId);
      expect(stageState.rows[0]?.stage_key).toBe("playoff");
      expect(stageState.rows[0]?.updated_at.toISOString()).toBe(updatedAt);
      expect(stageState.rows[0]?.data).toEqual({
        ...sourceData,
        participant: HISTORICAL_PARTICIPANTS.map((participant) => ({
          ...participant,
          rivalhubEntryId: entryIds[participant.id - 1],
        })),
      });

      const legacyState = await client.query<{ data: unknown }>(
        "SELECT data FROM competition_bracket_states WHERE competition_id = $1",
        [seasonId],
      );
      expect(legacyState.rows[0]?.data).toEqual(sourceData);
    });
  });
});

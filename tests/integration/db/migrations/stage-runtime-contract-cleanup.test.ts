import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { migrationFiles, replayMigration, withScratchDatabase } from "../harness/migration-replay";

const BACKFILL_MIGRATION = "0048_same_epoch.sql";
const CONTRACT_MIGRATION = "0049_ambiguous_brood.sql";
const HISTORICAL_PARTICIPANTS = Array.from({ length: 8 }, (_, index) => ({
  id: index + 1,
  name: `Historical entrant ${index + 1}`,
}));
const HISTORICAL_MATCHUPS: ReadonlyArray<readonly [number, number]> = [
  [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 1],
  [1, 3], [2, 4], [3, 5], [4, 6], [5, 7], [6, 8],
];

async function replayBeforeMigration(client: Client, migrationName: string): Promise<void> {
  for (const migration of migrationFiles((name) => name.endsWith(".sql") && name < migrationName)) {
    await replayMigration(client, migration);
  }
}

interface HistoricalRivalsFixture {
  seasonId: string;
  entryIds: string[];
  sourceData: {
    stage: unknown[];
    match: Array<{ id: string; opponent1: { id: number }; opponent2: { id: number } }>;
    match_game: unknown[];
    participant: Array<{ id: number; name: string }>;
    group: unknown[];
    round: unknown[];
  };
}

async function seedHistoricalRivals(client: Client): Promise<HistoricalRivalsFixture> {
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
         VALUES ($1, NULL, $2, '0049-contract-test')`,
        [entryIds[index], userIds[index]],
      );
      await client.query(
        `INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by, approved_at)
         VALUES ($1, $2, 1, 'approved', '0049-contract-test', now())`,
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

  return { seasonId, entryIds, sourceData };
}

async function expectLegacyRelationsToRemain(client: Client): Promise<void> {
  const legacyRelations = await client.query<{ bracket_table: string | null; standings_table: string | null }>(
    `SELECT to_regclass('public.competition_bracket_states')::text AS bracket_table,
            to_regclass('public.swiss_standings')::text AS standings_table`,
  );
  expect(legacyRelations.rows[0]?.bracket_table).toBe("competition_bracket_states");
  expect(legacyRelations.rows[0]?.standings_table).toBe("swiss_standings");
}

describe("Release N+1 stage runtime contract cleanup", () => {
  it("preserves the canonical backfill and physically drops both legacy relations", async () => {
    await withScratchDatabase("rivalhub_stage_runtime_cleanup", async (client) => {
      await replayBeforeMigration(client, BACKFILL_MIGRATION);

      const { seasonId, entryIds, sourceData } = await seedHistoricalRivals(client);

      await replayMigration(client, BACKFILL_MIGRATION);

      const beforeCleanup = await client.query<{ competition_id: string; stage_key: string; data: unknown; updated_at: Date }>(
        "SELECT competition_id, stage_key, data, updated_at FROM competition_stage_bracket_states",
      );
      expect(beforeCleanup.rows).toHaveLength(1);
      expect(beforeCleanup.rows[0]?.competition_id).toBe(seasonId);
      expect(beforeCleanup.rows[0]?.stage_key).toBe("playoff");
      expect(beforeCleanup.rows[0]?.updated_at.toISOString()).toBe("2026-09-09T12:00:00.000Z");
      expect(beforeCleanup.rows[0]?.data).toEqual({
        ...sourceData,
        participant: HISTORICAL_PARTICIPANTS.map((participant) => ({
          ...participant,
          rivalhubEntryId: entryIds[participant.id - 1],
        })),
      });

      await replayMigration(client, CONTRACT_MIGRATION);

      const afterCleanup = await client.query<{ data: unknown }>(
        "SELECT data FROM competition_stage_bracket_states WHERE competition_id = $1 AND stage_key = 'playoff'",
        [seasonId],
      );
      expect(afterCleanup.rows[0]?.data).toEqual(beforeCleanup.rows[0]?.data);

      const managedMatches = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM matches
         WHERE season_id = $1 AND stage = 'playoff' AND bracket_node_id IS NOT NULL`,
        [seasonId],
      );
      expect(managedMatches.rows[0]?.count).toBe("14");

      const legacyRelations = await client.query<{ bracket_table: string | null; standings_table: string | null }>(
        `SELECT to_regclass('public.competition_bracket_states')::text AS bracket_table,
                to_regclass('public.swiss_standings')::text AS standings_table`,
      );
      expect(legacyRelations.rows[0]).toEqual({ bracket_table: null, standings_table: null });
    });
  });

  it("fails closed and keeps both relations when two participant rivalhubEntryId mappings are swapped", async () => {
    await withScratchDatabase("rivalhub_stage_runtime_swapped_participants", async (client) => {
      await replayBeforeMigration(client, BACKFILL_MIGRATION);
      const { seasonId } = await seedHistoricalRivals(client);
      await replayMigration(client, BACKFILL_MIGRATION);

      // Mutate canonical playoff state to swap participant 1 and participant 2 rivalhubEntryId mappings
      await client.query(
        `UPDATE competition_stage_bracket_states
         SET data = jsonb_set(
           jsonb_set(
             data,
             '{participant,0,rivalhubEntryId}',
             data->'participant'->1->'rivalhubEntryId'
           ),
           '{participant,1,rivalhubEntryId}',
           data->'participant'->0->'rivalhubEntryId'
         )
         WHERE competition_id = $1 AND stage_key = 'playoff'`,
        [seasonId],
      );

      await expect(replayMigration(client, CONTRACT_MIGRATION)).rejects.toThrow(
        "does not match proven candidate",
      );
      await expectLegacyRelationsToRemain(client);

      const legacyRows = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM competition_bracket_states",
      );
      expect(legacyRows.rows[0]?.count).toBe("1");
    });
  });

  it("fails closed and keeps both relations when 14 managed matches exist but a bracket node id is tampered", async () => {
    await withScratchDatabase("rivalhub_stage_runtime_tampered_node", async (client) => {
      await replayBeforeMigration(client, BACKFILL_MIGRATION);
      const { seasonId } = await seedHistoricalRivals(client);
      await replayMigration(client, BACKFILL_MIGRATION);

      // Keep managed match count at exactly 14, but tamper with one bracket_node_id
      await client.query(
        `UPDATE matches
         SET bracket_node_id = 'historical-playoff-tampered'
         WHERE id = (
           SELECT id FROM matches
           WHERE season_id = $1 AND stage = 'playoff' AND bracket_node_id = 'historical-playoff-1'
           LIMIT 1
         )`,
        [seasonId],
      );

      await expect(replayMigration(client, CONTRACT_MIGRATION)).rejects.toThrow(
        "exact match set equality failed",
      );
      await expectLegacyRelationsToRemain(client);

      const legacyRows = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM competition_bracket_states",
      );
      expect(legacyRows.rows[0]?.count).toBe("1");
    });
  });

  it("fails closed and keeps both relations when a participant rivalhubEntryId points to another competition", async () => {
    await withScratchDatabase("rivalhub_stage_runtime_foreign_entry", async (client) => {
      await replayBeforeMigration(client, BACKFILL_MIGRATION);
      const { seasonId } = await seedHistoricalRivals(client);
      await replayMigration(client, BACKFILL_MIGRATION);

      // Create an entry in a different competition
      const otherSeasonId = randomUUID();
      const otherUserId = randomUUID();
      const otherEntryId = randomUUID();
      const otherRevisionId = randomUUID();

      await client.query("BEGIN");
      await client.query(
        "INSERT INTO seasons (id, slug, name, kind, status) VALUES ($1, 'other-rivals-season', 'Other Rivals Season', 'Rivals', 'finished')",
        [otherSeasonId],
      );
      await client.query("INSERT INTO users (id, email) VALUES ($1, $2)", [
        otherUserId,
        "other-user@local.test",
      ]);
      await client.query(
        `INSERT INTO competition_entries (
           id, competition_id, source, name, representative_user_id,
           current_roster_revision_id, approved_roster_revision_id, registration_status
         ) VALUES ($1, $2, 'event_native', 'Other Entry', $3, $4, $4, 'approved')`,
        [otherEntryId, otherSeasonId, otherUserId, otherRevisionId],
      );
      await client.query(
        `INSERT INTO competition_entry_representative_changes (entry_id, from_user_id, to_user_id, changed_by_actor_id)
         VALUES ($1, NULL, $2, '0049-contract-test')`,
        [otherEntryId, otherUserId],
      );
      await client.query(
        `INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by, approved_at)
         VALUES ($1, $2, 1, 'approved', '0049-contract-test', now())`,
        [otherRevisionId, otherEntryId],
      );
      await client.query("COMMIT");

      // Point participant 1 to the foreign competition entry
      await client.query(
        `UPDATE competition_stage_bracket_states
         SET data = jsonb_set(
           data,
           '{participant,0,rivalhubEntryId}',
           to_jsonb($2::text)
         )
         WHERE competition_id = $1 AND stage_key = 'playoff'`,
        [seasonId, otherEntryId],
      );

      await expect(replayMigration(client, CONTRACT_MIGRATION)).rejects.toThrow(
        "does not belong to competition",
      );
      await expectLegacyRelationsToRemain(client);
    });
  });

  it("fails closed and keeps both relations when canonical updated_at does not match legacy updated_at", async () => {
    await withScratchDatabase("rivalhub_stage_runtime_updated_at_mismatch", async (client) => {
      await replayBeforeMigration(client, BACKFILL_MIGRATION);
      const { seasonId } = await seedHistoricalRivals(client);
      await replayMigration(client, BACKFILL_MIGRATION);

      await client.query(
        `UPDATE competition_stage_bracket_states
         SET updated_at = updated_at + interval '1 day'
         WHERE competition_id = $1 AND stage_key = 'playoff'`,
        [seasonId],
      );

      await expect(replayMigration(client, CONTRACT_MIGRATION)).rejects.toThrow(
        "canonical playoff updated_at",
      );
      await expectLegacyRelationsToRemain(client);
    });
  });

  it("fails closed and keeps both relations when an unknown legacy bracket row exists", async () => {
    await withScratchDatabase("rivalhub_stage_runtime_unknown_row", async (client) => {
      await replayBeforeMigration(client, BACKFILL_MIGRATION);
      const { seasonId } = await seedHistoricalRivals(client);
      await replayMigration(client, BACKFILL_MIGRATION);

      const unknownSeasonId = randomUUID();
      await client.query(
        "INSERT INTO seasons (id, slug, name, kind, status) VALUES ($1, 'unknown-legacy-contract', 'Unknown legacy contract', 'Rivals', 'finished')",
        [unknownSeasonId],
      );
      await client.query(
        "INSERT INTO competition_bracket_states (competition_id, data) VALUES ($1, '{}'::jsonb)",
        [unknownSeasonId],
      );

      await expect(replayMigration(client, CONTRACT_MIGRATION)).rejects.toThrow(
        "expected zero or one deterministic competition_bracket_states row, got 2",
      );
      await expectLegacyRelationsToRemain(client);

      const legacyRows = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM competition_bracket_states",
      );
      expect(legacyRows.rows[0]?.count).toBe("2");
      const canonicalRows = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM competition_stage_bracket_states WHERE competition_id = $1 AND stage_key = 'playoff'",
        [seasonId],
      );
      expect(canonicalRows.rows[0]?.count).toBe("1");
    });
  });

  it("fails closed and keeps both relations when Swiss projection data remains", async () => {
    await withScratchDatabase("rivalhub_stage_runtime_swiss_rows", async (client) => {
      await replayBeforeMigration(client, BACKFILL_MIGRATION);
      const { seasonId, entryIds } = await seedHistoricalRivals(client);
      await replayMigration(client, BACKFILL_MIGRATION);
      await client.query(
        "INSERT INTO swiss_standings (season_id, stage, entry_id, seed) VALUES ($1, 'swiss', $2, 1)",
        [seasonId, entryIds[0]],
      );

      await expect(replayMigration(client, CONTRACT_MIGRATION)).rejects.toThrow(
        "swiss_standings contains 1 residual row(s)",
      );
      await expectLegacyRelationsToRemain(client);
    });
  });

  it("fails closed and keeps both relations when an external database dependency blocks DROP", async () => {
    await withScratchDatabase("rivalhub_stage_runtime_dependency", async (client) => {
      await replayBeforeMigration(client, BACKFILL_MIGRATION);
      const { seasonId } = await seedHistoricalRivals(client);
      await replayMigration(client, BACKFILL_MIGRATION);
      await client.query(
        "CREATE VIEW external_swiss_standings_dependency AS SELECT id FROM swiss_standings",
      );

      await expect(replayMigration(client, CONTRACT_MIGRATION)).rejects.toThrow("swiss_standings");
      await expectLegacyRelationsToRemain(client);

      const canonicalRows = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM competition_stage_bracket_states WHERE competition_id = $1 AND stage_key = 'playoff'",
        [seasonId],
      );
      expect(canonicalRows.rows[0]?.count).toBe("1");
    });
  });
});

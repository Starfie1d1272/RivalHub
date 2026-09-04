import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { capturePostgresError } from "../harness/database";
import { migrationFiles, replayMigration, withScratchDatabase } from "../harness/migration-replay";

interface ScoreFixture {
  seasonId: string;
  entryAId: string;
  entryBId: string;
  legacyNormalMatchId: string;
  legacyNormalMapId: string;
  canonicalMatchId: string;
  canonicalMapId: string;
  conflictMatchId: string;
  multipleMapsMatchId: string;
  legacyForfeitMatchId: string;
  legacyForfeitMapId: string;
}

function targetMigration(): string {
  const target = migrationFiles((name) => name.endsWith("_match_score_semantics.sql"))[0];
  if (!target) throw new Error("找不到 match score semantics migration。");
  return target;
}

async function replayBefore(client: Client, target: string): Promise<void> {
  for (const migration of migrationFiles((name) => name.endsWith(".sql") && name < target)) {
    await replayMigration(client, migration);
  }
}

async function insertMatch(
  client: Client,
  args: {
    id: string;
    seasonId: string;
    entryAId: string;
    entryBId: string;
    format?: "bo1" | "bo3" | "bo5";
    scoreA: number | null;
    scoreB: number | null;
    isForfeit?: boolean;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO matches (
       id, season_id, entry_a_id, entry_b_id, stage, format, status,
       score_a, score_b, is_forfeit, completed_at
     ) VALUES ($1, $2, $3, $4, 'qualifier', $5, 'finished', $6, $7, $8, '2026-08-01T10:00:00Z')`,
    [
      args.id,
      args.seasonId,
      args.entryAId,
      args.entryBId,
      args.format ?? "bo1",
      args.scoreA,
      args.scoreB,
      args.isForfeit ?? false,
    ],
  );
}

async function insertMap(
  client: Client,
  args: {
    id: string;
    matchId: string;
    mapOrder: number;
    scoreA: number | null;
    scoreB: number | null;
    completedAt?: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO match_maps (id, match_id, map_order, map_name, score_a, score_b, completed_at)
     VALUES ($1, $2, $3, 'de_mirage', $4, $5, $6)`,
    [args.id, args.matchId, args.mapOrder, args.scoreA, args.scoreB, args.completedAt ?? null],
  );
}

async function insertScoreFixture(client: Client): Promise<ScoreFixture> {
  const fixture: ScoreFixture = {
    seasonId: randomUUID(),
    entryAId: randomUUID(),
    entryBId: randomUUID(),
    legacyNormalMatchId: randomUUID(),
    legacyNormalMapId: randomUUID(),
    canonicalMatchId: randomUUID(),
    canonicalMapId: randomUUID(),
    conflictMatchId: randomUUID(),
    multipleMapsMatchId: randomUUID(),
    legacyForfeitMatchId: randomUUID(),
    legacyForfeitMapId: randomUUID(),
  };
  const userAId = randomUUID();
  const userBId = randomUUID();
  const revisionAId = randomUUID();
  const revisionBId = randomUUID();

  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)", [
      userAId,
      `score-a-${fixture.seasonId}@local.test`,
      userBId,
      `score-b-${fixture.seasonId}@local.test`,
    ]);
    await client.query(
      "INSERT INTO seasons (id, slug, name, kind, status) VALUES ($1, $2, 'Match score semantics', 'Rivals', 'finished')",
      [fixture.seasonId, `match-score-semantics-${fixture.seasonId}`],
    );
    await client.query(
      `INSERT INTO competition_entries (
         id, competition_id, source, name, representative_user_id,
         current_roster_revision_id, approved_roster_revision_id, registration_status
       ) VALUES ($1, $2, 'event_native', 'Score A', $3, $4, $4, 'approved'),
                ($5, $2, 'event_native', 'Score B', $6, $7, $7, 'approved')`,
      [fixture.entryAId, fixture.seasonId, userAId, revisionAId, fixture.entryBId, userBId, revisionBId],
    );
    await client.query(
      `INSERT INTO competition_entry_representative_changes (entry_id, from_user_id, to_user_id, changed_by_actor_id)
       VALUES ($1, NULL, $2, 'migration-test'), ($3, NULL, $4, 'migration-test')`,
      [fixture.entryAId, userAId, fixture.entryBId, userBId],
    );
    await client.query(
      `INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, created_by, approved_at)
       VALUES ($1, $2, 1, 'approved', 'migration-test', now()),
              ($3, $4, 1, 'approved', 'migration-test', now())`,
      [revisionAId, fixture.entryAId, revisionBId, fixture.entryBId],
    );

    await insertMatch(client, {
      id: fixture.legacyNormalMatchId,
      seasonId: fixture.seasonId,
      entryAId: fixture.entryAId,
      entryBId: fixture.entryBId,
      scoreA: 13,
      scoreB: 8,
    });
    await insertMap(client, {
      id: fixture.legacyNormalMapId,
      matchId: fixture.legacyNormalMatchId,
      mapOrder: 1,
      scoreA: null,
      scoreB: null,
    });

    await insertMatch(client, {
      id: fixture.canonicalMatchId,
      seasonId: fixture.seasonId,
      entryAId: fixture.entryAId,
      entryBId: fixture.entryBId,
      scoreA: 1,
      scoreB: 0,
    });
    await insertMap(client, {
      id: fixture.canonicalMapId,
      matchId: fixture.canonicalMatchId,
      mapOrder: 1,
      scoreA: 13,
      scoreB: 8,
      completedAt: "2026-08-01T10:01:00Z",
    });

    await insertMatch(client, {
      id: fixture.conflictMatchId,
      seasonId: fixture.seasonId,
      entryAId: fixture.entryAId,
      entryBId: fixture.entryBId,
      scoreA: 1,
      scoreB: 0,
    });
    await insertMap(client, {
      id: randomUUID(),
      matchId: fixture.conflictMatchId,
      mapOrder: 1,
      scoreA: 8,
      scoreB: 13,
      completedAt: "2026-08-01T10:01:00Z",
    });

    await insertMatch(client, {
      id: fixture.multipleMapsMatchId,
      seasonId: fixture.seasonId,
      entryAId: fixture.entryAId,
      entryBId: fixture.entryBId,
      scoreA: 13,
      scoreB: 8,
    });
    await insertMap(client, {
      id: randomUUID(),
      matchId: fixture.multipleMapsMatchId,
      mapOrder: 1,
      scoreA: null,
      scoreB: null,
    });
    await insertMap(client, {
      id: randomUUID(),
      matchId: fixture.multipleMapsMatchId,
      mapOrder: 2,
      scoreA: null,
      scoreB: null,
    });

    await insertMatch(client, {
      id: fixture.legacyForfeitMatchId,
      seasonId: fixture.seasonId,
      entryAId: fixture.entryAId,
      entryBId: fixture.entryBId,
      scoreA: 13,
      scoreB: 0,
      isForfeit: true,
    });
    await insertMap(client, {
      id: fixture.legacyForfeitMapId,
      matchId: fixture.legacyForfeitMatchId,
      mapOrder: 1,
      scoreA: null,
      scoreB: null,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }

  return fixture;
}

async function assertMigrationFailedClosed(client: Client, fixture: ScoreFixture, target: string): Promise<void> {
  await expect(replayMigration(client, target)).rejects.toThrow(/preflight failed/);

  const matches = await client.query<{ id: string; score_a: number; score_b: number }>(
    `SELECT id, score_a, score_b FROM matches
     WHERE id IN ($1, $2, $3, $4)
     ORDER BY id`,
    [fixture.legacyNormalMatchId, fixture.canonicalMatchId, fixture.conflictMatchId, fixture.legacyForfeitMatchId],
  );
  expect(matches.rows).toHaveLength(4);
  expect(matches.rows.find((row) => row.id === fixture.legacyNormalMatchId)).toMatchObject({ score_a: 13, score_b: 8 });
  expect(matches.rows.find((row) => row.id === fixture.canonicalMatchId)).toMatchObject({ score_a: 1, score_b: 0 });
  expect(matches.rows.find((row) => row.id === fixture.conflictMatchId)).toMatchObject({ score_a: 1, score_b: 0 });
  expect(matches.rows.find((row) => row.id === fixture.legacyForfeitMatchId)).toMatchObject({ score_a: 13, score_b: 0 });

  const normalMap = await client.query<{ score_a: number | null; score_b: number | null }>(
    "SELECT score_a, score_b FROM match_maps WHERE id = $1",
    [fixture.legacyNormalMapId],
  );
  expect(normalMap.rows[0]).toEqual({ score_a: null, score_b: null });
}

async function assertConstraints(client: Client, fixture: ScoreFixture): Promise<void> {
  await client.query("BEGIN");
  try {
    const halfMatch = await capturePostgresError(client, () => client.query(
      `INSERT INTO matches (id, season_id, entry_a_id, entry_b_id, stage, format, score_a, score_b)
       VALUES ($1, $2, $3, $4, 'qualifier', 'bo1', 1, NULL)`,
      [randomUUID(), fixture.seasonId, fixture.entryAId, fixture.entryBId],
    ));
    expect(halfMatch).toMatchObject({ code: "23514" });

    const halfMap = await capturePostgresError(client, () => client.query(
      `INSERT INTO match_maps (id, match_id, map_order, map_name, score_a, score_b)
       VALUES ($1, $2, 2, 'de_nuke', 13, NULL)`,
      [randomUUID(), fixture.canonicalMatchId],
    ));
    expect(halfMap).toMatchObject({ code: "23514" });

    const oldBo1 = await capturePostgresError(client, () => insertMatch(client, {
      id: randomUUID(),
      seasonId: fixture.seasonId,
      entryAId: fixture.entryAId,
      entryBId: fixture.entryBId,
      scoreA: 13,
      scoreB: 8,
    }));
    expect(oldBo1).toMatchObject({ code: "23514" });

    await insertMatch(client, {
      id: randomUUID(),
      seasonId: fixture.seasonId,
      entryAId: fixture.entryAId,
      entryBId: fixture.entryBId,
      scoreA: 1,
      scoreB: 0,
    });
    await insertMatch(client, {
      id: randomUUID(),
      seasonId: fixture.seasonId,
      entryAId: fixture.entryAId,
      entryBId: fixture.entryBId,
      format: "bo3",
      scoreA: 2,
      scoreB: 1,
    });

    const oldBo3 = await capturePostgresError(client, () => insertMatch(client, {
      id: randomUUID(),
      seasonId: fixture.seasonId,
      entryAId: fixture.entryAId,
      entryBId: fixture.entryBId,
      format: "bo3",
      scoreA: 13,
      scoreB: 8,
    }));
    expect(oldBo3).toMatchObject({ code: "23514" });
  } finally {
    await client.query("ROLLBACK");
  }
}

describe("match score semantics migration", () => {
  it("backfills legacy BO1 facts, rejects malformed data before writing, and replays idempotently", async () => {
    await withScratchDatabase("rivalhub_match_score_semantics", async (client) => {
      const target = targetMigration();
      await replayBefore(client, target);
      const fixture = await insertScoreFixture(client);

      await assertMigrationFailedClosed(client, fixture, target);
      await client.query("DELETE FROM match_maps WHERE match_id IN ($1, $2)", [fixture.conflictMatchId, fixture.multipleMapsMatchId]);
      await client.query("DELETE FROM matches WHERE id IN ($1, $2)", [fixture.conflictMatchId, fixture.multipleMapsMatchId]);

      await replayMigration(client, target);
      const normal = await client.query<{ score_a: number; score_b: number; is_forfeit: boolean }>(
        "SELECT score_a, score_b, is_forfeit FROM matches WHERE id = $1",
        [fixture.legacyNormalMatchId],
      );
      expect(normal.rows[0]).toEqual({ score_a: 1, score_b: 0, is_forfeit: false });
      const normalMap = await client.query<{ id: string; score_a: number; score_b: number; completed_at: Date }>(
        "SELECT id, score_a, score_b, completed_at FROM match_maps WHERE id = $1",
        [fixture.legacyNormalMapId],
      );
      expect(normalMap.rows[0]?.id).toBe(fixture.legacyNormalMapId);
      expect(normalMap.rows[0]?.score_a).toBe(13);
      expect(normalMap.rows[0]?.score_b).toBe(8);
      expect(normalMap.rows[0]?.completed_at.toISOString()).toBe("2026-08-01T10:00:00.000Z");

      const playerStatId = randomUUID();
      await client.query(
        "INSERT INTO match_player_stats (id, match_id, map_id, perfect_name) VALUES ($1, $2, $3, 'Migration Player')",
        [playerStatId, fixture.legacyNormalMatchId, fixture.legacyNormalMapId],
      );
      const preservedStat = await client.query<{ id: string; map_id: string }>(
        "SELECT id, map_id FROM match_player_stats WHERE id = $1",
        [playerStatId],
      );
      expect(preservedStat.rows[0]).toEqual({ id: playerStatId, map_id: fixture.legacyNormalMapId });

      const canonical = await client.query<{ score_a: number; score_b: number }>(
        "SELECT score_a, score_b FROM matches WHERE id = $1",
        [fixture.canonicalMatchId],
      );
      expect(canonical.rows[0]).toEqual({ score_a: 1, score_b: 0 });
      const forfeit = await client.query<{ score_a: number; score_b: number; is_forfeit: boolean }>(
        "SELECT score_a, score_b, is_forfeit FROM matches WHERE id = $1",
        [fixture.legacyForfeitMatchId],
      );
      expect(forfeit.rows[0]).toEqual({ score_a: 1, score_b: 0, is_forfeit: true });
      const forfeitMaps = await client.query("SELECT id FROM match_maps WHERE id = $1", [fixture.legacyForfeitMapId]);
      expect(forfeitMaps.rows).toHaveLength(0);

      await replayMigration(client, target);
      const replayed = await client.query<{ score_a: number; score_b: number }>(
        "SELECT score_a, score_b FROM matches WHERE id = $1",
        [fixture.legacyNormalMatchId],
      );
      expect(replayed.rows[0]).toEqual({ score_a: 1, score_b: 0 });
      await assertConstraints(client, fixture);
    });
  });
});

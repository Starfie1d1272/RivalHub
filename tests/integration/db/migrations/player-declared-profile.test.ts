import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { migrationFiles, replayMigration, withScratchDatabase } from "../harness/migration-replay";

const TARGET_MIGRATION = "0044_cultured_supernaut.sql";

describe("player-declared profile migration", () => {
  it("backfills one deterministic approved snapshot without overwriting profile values or history", async () => {
    await withScratchDatabase("rivalhub_0044_player_declared_profile", async (client: Client) => {
      const migrations = migrationFiles((name) => /^\d{4}_.*\.sql$/.test(name));
      for (const migration of migrations.filter((name) => name < TARGET_MIGRATION)) {
        await replayMigration(client, migration);
      }

      const userId = randomUUID();
      const existingProfileUserId = randomUUID();
      const pendingOnlyUserId = randomUUID();
      await client.query(
        `INSERT INTO users (id, email) VALUES
          ($1, $2),
          ($3, $4),
          ($5, $6)`,
        [
          userId,
          `profile-backfill-${userId}@local.test`,
          existingProfileUserId,
          `profile-existing-${existingProfileUserId}@local.test`,
          pendingOnlyUserId,
          `profile-pending-${pendingOnlyUserId}@local.test`,
        ],
      );
      const seasons = [
        ["00000000-0000-4000-8000-000000000001", "2026-01-01T00:00:00Z"],
        ["00000000-0000-4000-8000-000000000002", "2026-02-01T00:00:00Z"],
        ["00000000-0000-4000-8000-000000000003", "2026-02-01T00:00:00Z"],
        ["00000000-0000-4000-8000-000000000004", "2026-02-01T00:00:00Z"],
        ["00000000-0000-4000-8000-000000000005", "2026-03-01T00:00:00Z"],
      ] as const;
      for (const [id, createdAt] of seasons) {
        await client.query(
          `INSERT INTO seasons (id, slug, name, kind, created_at)
           VALUES ($1, $2, $3, 'rivals', $4)`,
          [id, `profile-backfill-${id}`, `Profile backfill ${id}`, createdAt],
        );
      }

      const registrations = [
        ["00000000-0000-4000-8000-000000000001", userId, seasons[0][0], "2026-04-01T00:00:00Z", "旧赛季", "旧经历", "approved"],
        ["00000000-0000-4000-8000-000000000002", userId, seasons[1][0], "2026-01-01T00:00:00Z", "同日赛季一", "同日经历一", "approved"],
        ["00000000-0000-4000-8000-000000000003", userId, seasons[2][0], "2026-02-01T00:00:00Z", "同日报名较新", "不应被拼接", "approved"],
        ["00000000-0000-4000-8000-000000000004", userId, seasons[3][0], "2026-02-01T00:00:00Z", "ID 较新", null, "approved"],
        ["00000000-0000-4000-8000-000000000005", existingProfileUserId, seasons[4][0], "2026-03-02T00:00:00Z", "不能覆盖", "不能覆盖", "approved"],
        ["00000000-0000-4000-8000-000000000006", pendingOnlyUserId, seasons[4][0], "2026-03-03T00:00:00Z", "待审核", "待审核经历", "pending"],
      ] as const;
      for (const [id, registrationUserId, seasonId, createdAt, gameplayStyle, competitionHistory, status] of registrations) {
        await client.query(
          `INSERT INTO season_registrations (
             id, user_id, season_id, primary_position, secondary_position,
             peak_rank, peak_rank_season, peak_rating,
             current_season_peak_rank, current_rating,
             gameplay_style, competition_history, status, created_at
           ) VALUES ($1, $2, $3, 'opener', 'closer', 'A+', 'S1 2026', 1.5, 'A', 1.4, $4, $5, $6, $7)`,
          [id, registrationUserId, seasonId, gameplayStyle, competitionHistory, status, createdAt],
        );
      }

      const beforeSnapshots = await client.query(
        `SELECT id, gameplay_style, competition_history, status
         FROM season_registrations
         WHERE user_id = $1
         ORDER BY id`,
        [userId],
      );

      // Replay the exact migration statements while inserting an already
      // populated long-lived profile between the additive DDL and backfill.
      const migrationStatements = readFileSync(
        join(process.cwd(), "drizzle/migrations", TARGET_MIGRATION),
        "utf8",
      )
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean);
      await client.query("BEGIN");
      try {
        await client.query(migrationStatements[0]!);
        await client.query(migrationStatements[1]!);
        await client.query(
          `UPDATE users
           SET gameplay_style = '手动维护风格', competition_history = '手动维护经历'
           WHERE id = $1`,
          [existingProfileUserId],
        );
        await client.query(migrationStatements.slice(2).join("\n"));
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }

      const profiles = await client.query<{ id: string; gameplay_style: string | null; competition_history: string | null }>(
        `SELECT id, gameplay_style, competition_history
         FROM users
         WHERE id IN ($1, $2, $3)
         ORDER BY id`,
        [userId, existingProfileUserId, pendingOnlyUserId],
      );
      expect(profiles.rows).toEqual([
        { id: existingProfileUserId, gameplay_style: "手动维护风格", competition_history: "手动维护经历" },
        { id: pendingOnlyUserId, gameplay_style: null, competition_history: null },
        { id: userId, gameplay_style: "ID 较新", competition_history: null },
      ].sort((a, b) => a.id.localeCompare(b.id)));

      const afterSnapshots = await client.query(
        `SELECT id, gameplay_style, competition_history, status
         FROM season_registrations
         WHERE user_id = $1
         ORDER BY id`,
        [userId],
      );
      expect(afterSnapshots.rows).toEqual(beforeSnapshots.rows);
    });
  });
});

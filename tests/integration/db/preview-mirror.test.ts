import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertReviewedColumns,
  exportQuery,
  PREVIEW_COLUMNS,
  PREVIEW_STEAM_SHADOW_CLEANUP_MIGRATION,
  previewPolicyFor,
} from "../../../scripts/db/preview/policy";
import { readExpectedMigrations } from "../../../scripts/db/production-preflight";
import { migrationFiles, replayMigration, withScratchDatabase } from "./harness/migration-replay";
import { createLocalPool } from "./harness/database";

describe("preview mirror membership projection", () => {
  it("redacts ended reasons and reimports active and ended memberships under the DB invariant", async () => {
    const pool = createLocalPool({ max: 1 });
    const client = await pool.connect();
    const ids = { captain: randomUUID(), member: randomUUID(), team: randomUUID(), active: randomUUID(), ended: randomUUID() };
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)", [ids.captain, `preview-membership-${ids.captain}@local.test`, ids.member, `preview-membership-${ids.member}@local.test`]);
      await client.query("INSERT INTO teams (id, slug, name, creator_user_id, captain_user_id) VALUES ($1, $2, 'Preview membership team', $3, $3)", [ids.team, `preview-membership-${ids.team}`, ids.captain]);
      await client.query(`INSERT INTO team_memberships (id, team_id, user_id, status, ended_at, ended_reason, invited_by_user_id)
        VALUES ($1, $3, $4, 'active', NULL, NULL, $4), ($2, $3, $5, 'left', now(), 'kicked', $4)`, [ids.active, ids.ended, ids.team, ids.captain, ids.member]);

      const membershipIds = new Set<string>([ids.active, ids.ended]);
      const projected = (await client.query(exportQuery("team_memberships"))).rows
        .filter((row) => membershipIds.has(String(row.id)));
      const summarize = (rows: Array<Record<string, unknown>>) => rows.map((row) => ({ status: row.status, ended: row.ended_at !== null, ended_reason: row.ended_reason }))
        .sort((a, b) => Number(a.ended) - Number(b.ended));
      expect(summarize(projected)).toEqual([
        { status: "active", ended: false, ended_reason: null },
        { status: "left", ended: true, ended_reason: "left" },
      ]);

      await client.query("DELETE FROM team_memberships WHERE id = ANY($1::uuid[])", [[ids.active, ids.ended]]);
      await client.query(`INSERT INTO public."team_memberships" ("id", "team_id", "user_id", "status", "started_at", "ended_at", "invited_by_user_id", "created_at", "updated_at", "ended_reason")
        SELECT "id", "team_id", "user_id", "status", "started_at", "ended_at", "invited_by_user_id", "created_at", "updated_at", "ended_reason"
        FROM jsonb_populate_recordset(NULL::public."team_memberships", $1::jsonb)`, [JSON.stringify(projected)]);
      const imported = (await client.query("SELECT id, status, ended_at, ended_reason::text AS ended_reason FROM team_memberships WHERE id = ANY($1::uuid[]) ORDER BY id", [[ids.active, ids.ended]])).rows;
      expect(summarize(imported)).toEqual([
        { status: "active", ended: false, ended_reason: null },
        { status: "left", ended: true, ended_reason: "left" },
      ]);
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
      await pool.end();
    }
  });

  it("validates the real latest physical inventory and the previous N schema against source-aware policy", async () => {
    const expected = readExpectedMigrations();
    const latestPool = createLocalPool({ max: 1 });
    const latest = await latestPool.connect();
    try {
      const catalog = await latest.query<{ table_name: string; column_name: string }>(
        "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position",
      );
      const inventory = new Map<string, string[]>();
      for (const row of catalog.rows) inventory.set(row.table_name, [...(inventory.get(row.table_name) ?? []), row.column_name]);
      for (const [table, columns] of inventory) assertReviewedColumns(table, columns);

      const users = inventory.get("users") ?? [];
      expect(users).not.toEqual(expect.arrayContaining(["steam_name", "steam_profile_url", "avatar_url"]));
      expect(inventory.has("steam_profiles")).toBe(true);
      expect(PREVIEW_COLUMNS.users).not.toContain("steam_name");
    } finally {
      latest.release();
      await latestPool.end();
    }

    await withScratchDatabase("preview_source_policy", async (client) => {
      const steamProfileMigrationIndex = expected.findIndex(({ tag }) => tag === "0052_gray_supernaut");
      expect(steamProfileMigrationIndex).toBeGreaterThan(0);
      const sourceExpected = expected.slice(0, steamProfileMigrationIndex);
      const sourceMigrations = sourceExpected.map(({ hash, when }) => ({ hash, when }));
      for (const migration of migrationFiles((name) => name < "0052_gray_supernaut.sql")) {
        await replayMigration(client, migration);
      }

      const policy = previewPolicyFor(sourceMigrations);
      const catalog = await client.query<{ table_name: string; column_name: string }>(
        "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position",
      );
      const inventory = new Map<string, string[]>();
      for (const row of catalog.rows) inventory.set(row.table_name, [...(inventory.get(row.table_name) ?? []), row.column_name]);
      for (const [table, columns] of inventory) assertReviewedColumns(table, columns, policy);

      expect(policy.futureTables).toContain("steam_profiles");
      expect(inventory.has("steam_profiles")).toBe(false);
      for (const table of Object.keys(policy.tables)) expect(inventory.has(table)).toBe(true);

      await client.query('ALTER TABLE public.users DROP COLUMN "steam_name", DROP COLUMN "steam_profile_url", DROP COLUMN "avatar_url"');
      const cleanedUsers = (await client.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' ORDER BY ordinal_position",
      )).rows.map(({ column_name }) => column_name);
      expect(cleanedUsers).not.toEqual(expect.arrayContaining(["steam_name", "steam_profile_url", "avatar_url"]));
      expect(() => assertReviewedColumns("users", cleanedUsers, policy)).not.toThrow();

      const cleanupMigrationIndex = expected.findIndex(({ tag }) => tag === PREVIEW_STEAM_SHADOW_CLEANUP_MIGRATION);
      expect(cleanupMigrationIndex).toBeGreaterThan(0);
      const cleanupExpected = expected.slice(0, cleanupMigrationIndex + 1);
      const cleanupPolicy = previewPolicyFor(
        cleanupExpected.map(({ hash, when }) => ({ hash, when })),
        expected,
      );
      expect(() => assertReviewedColumns("users", cleanedUsers, cleanupPolicy)).not.toThrow();
      await client.query('ALTER TABLE public.users ADD COLUMN "steam_name" text');
      const reappearedUsers = (await client.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' ORDER BY ordinal_position",
      )).rows.map(({ column_name }) => column_name);
      expect(() => assertReviewedColumns("users", reappearedUsers, cleanupPolicy)).toThrow(/removed mirror column/);

      await client.query("CREATE TABLE public.preview_unreviewed_table (id uuid)");
      expect(() => assertReviewedColumns("preview_unreviewed_table", ["id"], policy)).toThrow();
      await client.query('ALTER TABLE public.users ADD COLUMN "preview_unreviewed" text');
      expect(() => assertReviewedColumns("users", [...cleanedUsers, "preview_unreviewed"], policy)).toThrow();
    });

    await withScratchDatabase("preview_pre_stats_policy", async (client) => {
      const statsMigrationIndex = expected.findIndex(({ tag }) => tag === "0051_sour_grim_reaper");
      expect(statsMigrationIndex).toBeGreaterThan(0);
      const sourceExpected = expected.slice(0, statsMigrationIndex);
      const sourceMigrations = sourceExpected.map(({ hash, when }) => ({ hash, when }));
      for (const migration of migrationFiles((name) => name < "0051_sour_grim_reaper.sql")) {
        await replayMigration(client, migration);
      }

      const policy = previewPolicyFor(sourceMigrations);
      const catalog = await client.query<{ table_name: string; column_name: string }>(
        "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position",
      );
      const inventory = new Map<string, string[]>();
      for (const row of catalog.rows) inventory.set(row.table_name, [...(inventory.get(row.table_name) ?? []), row.column_name]);
      for (const [table, columns] of inventory) assertReviewedColumns(table, columns, policy);

      const statsColumns = inventory.get("match_player_stats") ?? [];
      expect(statsColumns).not.toEqual(expect.arrayContaining(["first_deaths", "trade_kills", "kast_rounds", "dak_import_id"]));
      expect(policy.futureColumns.match_player_stats).toEqual(expect.arrayContaining(["first_deaths", "trade_kills", "kast_rounds", "dak_import_id"]));
      for (const table of Object.keys(policy.tables)) expect(inventory.has(table)).toBe(true);
    });
  });
});

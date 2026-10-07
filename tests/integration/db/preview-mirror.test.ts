import { drizzle } from "drizzle-orm/node-postgres";
import { migrateCanonicalDatabase } from "../../../scripts/db/canonical-migrate";
import { importSnapshot } from "../../../scripts/db/preview/refresh";
import { type MirrorSnapshot } from "../../../scripts/db/preview/snapshot";
import { verifyForeignKeys } from "../../../scripts/db/recovery/verify";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertReviewedColumns,
  exportQuery,
  PREVIEW_COLUMNS,
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

  it("validates the real latest inventory and the Steam cleanup migration lifecycle", async () => {
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

      // Every required column must be projected or have a DB default, even for empty tables.
      const required = await latest.query<{ table_name: string; column_name: string }>(
        "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND is_nullable = 'NO' AND column_default IS NULL",
      );
      for (const table of Object.keys(previewPolicyFor(expected).tables)) {
        const fields = (await latest.query(`${exportQuery(table)} LIMIT 0`)).fields.map((field) => field.name);
        for (const column of required.rows.filter((column) => column.table_name === table)) {
          expect.soft(fields, `${table}.${column.column_name} must survive sanitization`).toContain(column.column_name);
        }
      }

      const projectionColumns = inventory.get("match_demo_stat_projections");
      expect(projectionColumns).toEqual(PREVIEW_COLUMNS.match_demo_stat_projections.split(" "));
      const projected = await latest.query(`${exportQuery("match_demo_stat_projections")} LIMIT 0`);
      expect(projected.fields.map((field) => field.name)).toEqual(projectionColumns);

      const users = inventory.get("users") ?? [];
      expect(users).not.toEqual(expect.arrayContaining(["steam_name", "steam_profile_url", "avatar_url"]));
      expect(inventory.has("steam_profiles")).toBe(true);
      expect(PREVIEW_COLUMNS.users).not.toContain("steam_name");
      expect(previewPolicyFor(expected).tables.users.removedColumns).toEqual(
        expect.arrayContaining(["steam_name", "steam_profile_url", "avatar_url"]),
      );
    } finally {
      latest.release();
      await latestPool.end();
    }

    await withScratchDatabase("preview_steam_cleanup", async (client) => {
      const cleanupTag = "0055_steam_profile_shadow_cleanup";
      const cleanupIndex = expected.findIndex(({ tag }) => tag === cleanupTag);
      expect(cleanupIndex).toBeGreaterThan(0);
      const beforeCleanup = expected.slice(0, cleanupIndex);
      const beforeCleanupPolicy = previewPolicyFor(beforeCleanup);
      for (const migration of migrationFiles((name) => name.endsWith(".sql") && name < `${cleanupTag}.sql`)) {
        await replayMigration(client, migration);
      }

      const previousCatalog = await client.query<{ table_name: string; column_name: string }>(
        "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position",
      );
      const previousInventory = new Map<string, string[]>();
      for (const row of previousCatalog.rows) previousInventory.set(row.table_name, [...(previousInventory.get(row.table_name) ?? []), row.column_name]);
      for (const [table, columns] of previousInventory) assertReviewedColumns(table, columns, beforeCleanupPolicy);

      const previousUsers = previousInventory.get("users") ?? [];
      expect(previousUsers).toEqual(expect.arrayContaining(["steam_name", "steam_profile_url", "avatar_url"]));
      expect(beforeCleanupPolicy.tables.users.omittedColumns).toEqual(
        expect.arrayContaining(["steam_name", "steam_profile_url", "avatar_url"]),
      );
      expect(beforeCleanupPolicy.tables.users.removedColumns).toEqual([]);
      expect(previousInventory.has("steam_profiles")).toBe(true);

      await replayMigration(client, `${cleanupTag}.sql`);
      const currentCatalog = await client.query<{ table_name: string; column_name: string }>(
        "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position",
      );
      const currentInventory = new Map<string, string[]>();
      for (const row of currentCatalog.rows) currentInventory.set(row.table_name, [...(currentInventory.get(row.table_name) ?? []), row.column_name]);
      const currentPolicy = previewPolicyFor(expected.slice(0, cleanupIndex + 1));
      for (const [table, columns] of currentInventory) assertReviewedColumns(table, columns, currentPolicy);

      const currentUsers = currentInventory.get("users") ?? [];
      expect(currentUsers).not.toEqual(expect.arrayContaining(["steam_name", "steam_profile_url", "avatar_url"]));
      expect(currentPolicy.tables.users.removedColumns).toEqual(
        expect.arrayContaining(["steam_name", "steam_profile_url", "avatar_url"]),
      );

      for (const column of ["steam_name", "steam_profile_url", "avatar_url"]) {
        await client.query(`ALTER TABLE public.users ADD COLUMN "${column}" text`);
        expect(() => assertReviewedColumns("users", [...currentUsers, column], currentPolicy)).toThrow(/removed mirror column/);
        await client.query(`ALTER TABLE public.users DROP COLUMN "${column}"`);
      }

      await client.query("CREATE TABLE public.preview_unreviewed_table (id uuid)");
      expect(() => assertReviewedColumns("preview_unreviewed_table", ["id"], currentPolicy)).toThrow();
      await client.query('ALTER TABLE public.users ADD COLUMN "preview_unreviewed" text');
      expect(() => assertReviewedColumns("users", [...currentUsers, "preview_unreviewed"], currentPolicy)).toThrow();
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


describe("preview qualification export/import contract", () => {
  it("round-trips drafts and unstarted/started/completed runs with redacted actors and valid references", async () => {
    await withScratchDatabase("preview_qualification", async (client) => {
      await migrateCanonicalDatabase(drizzle(client), "drizzle/migrations");
      const seasonIds = [randomUUID(), randomUUID(), randomUUID()];
      for (const [index, seasonId] of seasonIds.entries()) {
        await client.query("INSERT INTO seasons (id, slug, name, kind) VALUES ($1, $2, 'Preview contract', 'major')", [seasonId, `preview-${index}`]);
        await client.query(`INSERT INTO competition_qualification_drafts (season_id, "order", format, target_entrant_count, version, updated_by)
          VALUES ($1, '[]', 'direct_bo3', 1, 1, 'private-draft-admin')`, [seasonId]);
        await client.query(`INSERT INTO competition_qualification_runs
          (season_id, format, target_entrant_count, candidate_count, direct_entry_count, play_in_entry_count, qualifier_count, configured_by, started_at, started_by, completed_at)
          VALUES ($1, 'direct_bo3', 1, 2, 0, 2, 1, 'private-config-admin', $2, $3, $4)`,
        [seasonId, index > 0 ? "2026-10-01T00:00:00Z" : null, index > 0 ? "private-start-admin" : null, index > 1 ? "2026-10-02T00:00:00Z" : null]);
      }
      // Use real cyclic Entry/revision references and a qualification entrant, not orphan mock IDs.
      const userId = randomUUID(), entryId = randomUUID(), revisionId = randomUUID();
      await client.query("BEGIN");
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      await client.query("INSERT INTO users (id, email) VALUES ($1, 'source@local.test')", [userId]);
      await client.query(`INSERT INTO competition_entries (id, competition_id, source, name, representative_user_id, current_roster_revision_id)
        VALUES ($1, $2, 'event_native', 'Preview entry', $3, $4)`, [entryId, seasonIds[0], userId, revisionId]);
      await client.query(`INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, origin, created_by)
        VALUES ($1, $2, 1, 'draft', 'initial', 'fixture')`, [revisionId, entryId]);
      await client.query(`INSERT INTO competition_qualification_entrants (run_id, season_id, competition_entry_id, preliminary_seed)
        SELECT id, season_id, $2, 1 FROM competition_qualification_runs WHERE season_id=$1`, [seasonIds[0], entryId]);
      await client.query('UPDATE competition_qualification_drafts SET "order"=$2::jsonb WHERE season_id=$1', [seasonIds[0], JSON.stringify([entryId])]);
      await client.query(`INSERT INTO competition_entry_representative_changes (entry_id, from_user_id, to_user_id, changed_by_actor_id)
        VALUES ($1, NULL, $2, 'fixture')`, [entryId, userId]);
      const opponentId = randomUUID(), opponentRevisionId = randomUUID();
      await client.query(`INSERT INTO competition_entries (id, competition_id, source, name, representative_user_id, current_roster_revision_id)
        VALUES ($1, $2, 'event_native', 'Opponent', $3, $4)`, [opponentId, seasonIds[0], userId, opponentRevisionId]);
      await client.query(`INSERT INTO competition_entry_roster_revisions (id, entry_id, revision_number, status, origin, created_by)
        VALUES ($1, $2, 1, 'draft', 'initial', 'fixture')`, [opponentRevisionId, opponentId]);
      await client.query(`INSERT INTO competition_entry_representative_changes (entry_id, from_user_id, to_user_id, changed_by_actor_id)
        VALUES ($1, NULL, $2, 'fixture')`, [opponentId, userId]);
      const matchId = randomUUID(), incidentId = randomUUID();
      await client.query(`INSERT INTO matches (id, season_id, entry_a_id, entry_b_id, stage, qualification_run_id)
        SELECT $1, season_id, $2, $3, 'play-in', id FROM competition_qualification_runs WHERE season_id=$4`,
      [matchId, entryId, opponentId, seasonIds[0]]);
      await client.query(`INSERT INTO match_veto_timeout_incidents (id, match_id, turn_key, entry_id, representative_user_id, deadline_at, resolved_at, eligible_options, selected_options)
        VALUES ($1, $2, 'fixture', $3, $4, now(), now(), '[]', '[]')`, [incidentId, matchId, entryId, userId]);
      await client.query(`INSERT INTO match_veto_appeals (timeout_incident_id, submitted_by, reason)
        VALUES ($1, $2, 'private-appeal-reason')`, [incidentId, userId]);
      await client.query("COMMIT");

      const tables: MirrorSnapshot["tables"] = {};
      for (const table of Object.keys(previewPolicyFor(readExpectedMigrations()).tables)) {
        tables[table] = (await client.query(exportQuery(table))).rows;
      }
      expect(tables.match_veto_appeals[0].reason).toBe("预览已脱敏");
      expect(JSON.stringify(tables)).not.toContain("private-appeal-reason");
      expect(JSON.stringify(tables)).not.toMatch(/private-(draft|config|start)-admin/);
      expect(tables.competition_qualification_runs.map((row) => row.configured_by)).toEqual(Array(3).fill("preview:redacted"));
      expect(tables.competition_qualification_runs.filter((row) => row.started_by === null)).toHaveLength(1);
      const snapshot: MirrorSnapshot = { format: 2, sourceCommit: "a".repeat(40), sourceTag: "v2.15.0", refreshedAt: new Date().toISOString(),
        migrations: readExpectedMigrations(), assets: [], tables,
        personaCandidates: { currentSeasonId: null, playerUserId: null, invitedUserId: null, captainUserId: null, seasonAdminUserId: null, superAdminUserId: null } };
      await importSnapshot(client, snapshot);
      await verifyForeignKeys(client);
      expect((await client.query("SELECT updated_by FROM competition_qualification_drafts")).rows).toEqual(Array(3).fill({ updated_by: "preview:redacted" }));
      expect((await client.query(`SELECT count(*)::int AS count FROM competition_qualification_entrants e
        JOIN competition_qualification_runs r ON (r.id, r.season_id)=(e.run_id, e.season_id)
        JOIN competition_entries ce ON (ce.id, ce.competition_id)=(e.competition_entry_id, e.season_id)`)).rows).toEqual([{ count: 1 }]);
      expect((await client.query('SELECT "order" FROM competition_qualification_drafts WHERE season_id=$1', [seasonIds[0]])).rows[0].order).toEqual([entryId]);
      expect((await client.query(`SELECT count(*)::int AS count FROM matches m
        JOIN competition_qualification_runs r ON (r.id, r.season_id)=(m.qualification_run_id, m.season_id)`)).rows).toEqual([{ count: 1 }]);
      expect((await client.query("SELECT reason FROM match_veto_appeals")).rows).toEqual([{ reason: "预览已脱敏" }]);
      // Repeated refresh uses the same contract and does not accumulate synthetic identities.
      await importSnapshot(client, snapshot);
      await verifyForeignKeys(client);
      expect((await client.query("SELECT count(*)::int AS count FROM users")).rows).toEqual([{ count: 1 }]);
    });
  });
});

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

import {
  migrationFiles,
  replayMigration,
  withScratchDatabase,
} from "../harness/migration-replay";

const TERMINAL_MIGRATION = "0021_mature_deadpool.sql";

function preAuthMigrations(): string[] {
  return migrationFiles((name) => /^00(?:0[0-9]|1[0-9]|20)_.*\.sql$/.test(name))
    .filter((name) => name !== TERMINAL_MIGRATION);
}

async function replayBeforeAuthMigration(client: Client): Promise<void> {
  for (const migration of preAuthMigrations()) await replayMigration(client, migration);
}

async function runAuthMigrationExpectingFailure(client: Client, keyword: string): Promise<void> {
  const source = readFileSync(join(process.cwd(), "drizzle/migrations", TERMINAL_MIGRATION), "utf8");
  await client.query("BEGIN");
  try {
    await client.query(source);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toContain(keyword);
    return;
  }
  throw new Error("auth-permissions migration should fail closed for invalid legacy data");
}

async function expectLegacyShapeUnchanged(client: Client): Promise<void> {
  const columns = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM information_schema.columns
     WHERE table_name = 'users' AND column_name = 'admin_season_id'`,
  );
  const rootTable = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'admin_users'`,
  );
  expect(columns.rows[0]?.count).toBe("1");
  expect(rootTable.rows[0]?.count).toBe("1");
}

describe("auth-permissions migration", () => {
  it("backfills scoped grants and invite claims before removing legacy facts", async () => {
    await withScratchDatabase("rivalhub_auth_permissions", async (client) => {
      await replayBeforeAuthMigration(client);

      const seasonIds = [randomUUID(), randomUUID()];
      const seasonAdminId = randomUUID();
      const superAdminId = randomUUID();
      const claimantId = randomUUID();
      const inviteId = randomUUID();
      const globalInviteId = randomUUID();
      const updatedAt = "2026-08-30T02:03:04.000Z";
      const claimantEmail = `legacy-claimant-${claimantId}@local.test`;

      for (const [index, seasonId] of seasonIds.entries()) {
        await client.query(
          `INSERT INTO seasons (id, slug, name, kind, status)
           VALUES ($1, $2, $3, 'Rivals', 'draft')`,
          [seasonId, `auth-replay-${seasonId}`, `Auth Replay ${index}`],
        );
      }
      await client.query(
        `INSERT INTO users (id, email, role, admin_season_id, updated_at)
         VALUES ($1, $2, 'season_admin', $3::uuid[], $4),
                ($5, $6, 'super_admin', '{}'::uuid[], $4),
                ($7, $8, 'user', '{}'::uuid[], $4)`,
        [
          seasonAdminId,
          `legacy-season-admin-${seasonAdminId}@local.test`,
          seasonIds,
          updatedAt,
          superAdminId,
          `legacy-super-admin-${superAdminId}@local.test`,
          claimantId,
          claimantEmail,
        ],
      );
      await client.query(
        `INSERT INTO admin_invites
          (id, code, created_by, role, season_id, max_uses, used_count, used_by_usernames, is_active)
         VALUES ($1, 'LEGACY-SCOPED', 'RivalHub_root', 'admin', $2, 1, 1, $3::text[], true),
                ($4, 'LEGACY-GLOBAL', 'RivalHub_root', 'super_admin', NULL, 2, 0, '{}'::text[], true)`,
        [inviteId, seasonIds[0], [claimantEmail], globalInviteId],
      );
      await client.query(
        `INSERT INTO admin_users (id, username, password_hash, role)
         VALUES ($1, 'RivalHub_root', 'legacy-hash', 'super_admin')`,
        [randomUUID()],
      );

      await replayMigration(client, TERMINAL_MIGRATION);

      const enumValues = await client.query<{ enumlabel: string }>(
        `SELECT enumlabel
         FROM pg_enum
         WHERE enumtypid = 'public.user_role'::regtype
         ORDER BY enumsortorder`,
      );
      expect(enumValues.rows.map((row) => row.enumlabel)).toEqual(["user", "super_admin"]);

      const legacyColumn = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM information_schema.columns
         WHERE table_name = 'users' AND column_name = 'admin_season_id'`,
      );
      const rootTable = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'admin_users'`,
      );
      const rootType = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_type WHERE typname = 'admin_role'`,
      );
      const rls = await client.query<{ relname: string; relrowsecurity: boolean }>(
        `SELECT c.relname, c.relrowsecurity
         FROM pg_class AS c
         JOIN pg_namespace AS n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname IN ('admin_invite_claims', 'season_admin_grants')
         ORDER BY c.relname`,
      );
      expect(legacyColumn.rows[0]?.count).toBe("0");
      expect(rootTable.rows[0]?.count).toBe("0");
      expect(rootType.rows[0]?.count).toBe("0");
      expect(rls.rows).toEqual([
        { relname: "admin_invite_claims", relrowsecurity: true },
        { relname: "season_admin_grants", relrowsecurity: true },
      ]);

      const grants = await client.query<{ user_id: string; season_id: string; granted_at: Date }>(
        `SELECT user_id, season_id, granted_at
         FROM season_admin_grants WHERE user_id = $1 ORDER BY season_id`,
        [seasonAdminId],
      );
      expect(grants.rows.map((row) => row.season_id)).toEqual(seasonIds.slice().sort());
      expect(grants.rows.every((row) => row.granted_at.toISOString() === updatedAt)).toBe(true);

      const convertedUser = await client.query<{ role: string }>(
        "SELECT role::text FROM users WHERE id = $1",
        [seasonAdminId],
      );
      expect(convertedUser.rows[0]?.role).toBe("user");

      const claim = await client.query<{ user_id: string; claimed_at: Date }>(
        "SELECT user_id, claimed_at FROM admin_invite_claims WHERE invite_id = $1",
        [inviteId],
      );
      expect(claim.rows).toHaveLength(1);
      expect(claim.rows[0]?.user_id).toBe(claimantId);
      expect(claim.rows[0]?.claimed_at).toBeInstanceOf(Date);

      const invites = await client.query<{ role: string; season_id: string | null; is_active: boolean }>(
        `SELECT role::text, season_id, is_active
         FROM admin_invites WHERE id IN ($1, $2) ORDER BY code`,
        [inviteId, globalInviteId],
      );
      expect(invites.rows).toEqual([
        { role: "super_admin", season_id: null, is_active: true },
        { role: "season_admin", season_id: seasonIds[0], is_active: false },
      ]);
    });
  });

  it("fails closed before destructive DDL for legacy inconsistencies", async () => {
    const cases = [
      {
        prefix: "rivalhub_auth_bad_role_array",
        keyword: "inconsistent users.role/admin_season_id",
        setup: async (client: Client) => {
          const seasonId = randomUUID();
          await client.query(
            "INSERT INTO seasons (id, slug, name, kind, status) VALUES ($1, $2, 'Bad role array', 'Rivals', 'draft')",
            [seasonId, `bad-role-array-${seasonId}`],
          );
          await client.query(
            `INSERT INTO users (email, role, admin_season_id) VALUES ($1, 'user', $2::uuid[])`,
            [`bad-role-array-${seasonId}@local.test`, [seasonId]],
          );
        },
      },
      {
        prefix: "rivalhub_auth_bad_season_ref",
        keyword: "missing or invalid season grant reference",
        setup: async (client: Client) => {
          await client.query(
            `INSERT INTO users (email, role, admin_season_id) VALUES ($1, 'season_admin', $2::uuid[])`,
            [`bad-season-ref-${randomUUID()}@local.test`, [randomUUID()]],
          );
        },
      },
      {
        prefix: "rivalhub_auth_bad_invite_usage",
        keyword: "inconsistent admin invite usage data",
        setup: async (client: Client) => {
          await client.query(
            `INSERT INTO admin_invites (code, created_by, role, season_id, max_uses, used_count, used_by_usernames)
             VALUES ($1, 'legacy', 'super_admin', NULL, 1, 0, ARRAY['unmatched@local.test'])`,
            [`bad-invite-usage-${randomUUID()}`],
          );
        },
      },
      {
        prefix: "rivalhub_auth_bad_invite_claimant",
        keyword: "unresolvable admin invite claimant",
        setup: async (client: Client) => {
          await client.query(
            `INSERT INTO admin_invites (code, created_by, role, season_id, max_uses, used_count, used_by_usernames)
             VALUES ($1, 'legacy', 'super_admin', NULL, 1, 1, ARRAY['missing@local.test'])`,
            [`bad-invite-claimant-${randomUUID()}`],
          );
        },
      },
    ];

    for (const testCase of cases) {
      await withScratchDatabase(testCase.prefix, async (client) => {
        await replayBeforeAuthMigration(client);
        await testCase.setup(client);
        await runAuthMigrationExpectingFailure(client, testCase.keyword);
        await expectLegacyShapeUnchanged(client);
      });
    }
  });
});

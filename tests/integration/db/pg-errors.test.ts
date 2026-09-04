import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import * as schema from "../../../src/db/schema";
import { extractPgError } from "../../../src/db/errors";
import { inviteTeamMemberInTx } from "../../../src/lib/teams/commands";
import { ErrorCode } from "../../../src/lib/errors";
import { capturePostgresError, createLocalPool } from "./harness/database";

const PENDING_INVITATION_CONSTRAINT = "team_invitations_one_pending_direct_per_user";

type FixtureIds = {
  captain: string;
  invitee: string;
  team: string;
};

function makeFixtureIds(): FixtureIds {
  return { captain: randomUUID(), invitee: randomUUID(), team: randomUUID() };
}

function directInvitation(ids: FixtureIds, id = randomUUID()): typeof schema.teamInvitations.$inferInsert {
  return {
    id,
    teamId: ids.team,
    kind: "direct",
    invitedUserId: ids.invitee,
    invitedByUserId: ids.captain,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };
}

async function seedFixture(pool: Pool, ids: FixtureIds): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO users (id, email) VALUES ($1, $2), ($3, $4)",
      [ids.captain, `pg-errors-captain-${ids.captain}@local.test`, ids.invitee, `pg-errors-invitee-${ids.invitee}@local.test`],
    );
    await client.query(
      `INSERT INTO teams (id, slug, name, creator_user_id, captain_user_id)
       VALUES ($1, $2, 'PG error extraction team', $3, $3)`,
      [ids.team, `pg-errors-${ids.team.slice(0, 8)}`, ids.captain],
    );
    await client.query(
      `INSERT INTO team_memberships (team_id, user_id, status, invited_by_user_id)
       VALUES ($1, $2, 'active', $2)`,
      [ids.team, ids.captain],
    );
    await client.query(
      "INSERT INTO team_captain_changes (team_id, from_user_id, to_user_id, changed_by_actor_id) VALUES ($1, NULL, $2, 'pg-errors-test')",
      [ids.team, ids.captain],
    );
    await client.query(
      "INSERT INTO team_name_changes (team_id, old_name, new_name, changed_by_actor_id) VALUES ($1, NULL, 'PG error extraction team', 'pg-errors-test')",
      [ids.team],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupFixture(pool: Pool, ids: FixtureIds): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query("DELETE FROM team_invitations WHERE team_id = $1", [ids.team]);
    await client.query("DELETE FROM team_captain_changes WHERE team_id = $1", [ids.team]);
    await client.query("DELETE FROM team_name_changes WHERE team_id = $1", [ids.team]);
    await client.query("DELETE FROM team_memberships WHERE team_id = $1", [ids.team]);
    await client.query("DELETE FROM teams WHERE id = $1", [ids.team]);
    await client.query("DELETE FROM users WHERE id IN ($1, $2)", [ids.captain, ids.invitee]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

describe("PostgreSQL error extraction integration", () => {
  it("extracts the constraint from a real Drizzle unique violation", async () => {
    const pool = createLocalPool({ max: 2 });
    const ids = makeFixtureIds();
    const client = await pool.connect();

    try {
      await seedFixture(pool, ids);
      await client.query("BEGIN");
      const database = drizzle(client, { schema });
      await database.insert(schema.teamInvitations).values(directInvitation(ids));

      const thrown = await capturePostgresError(client, () =>
        database.insert(schema.teamInvitations).values(directInvitation(ids)),
      );

      expect(thrown).toBeInstanceOf(Error);
      const info = extractPgError(thrown);
      expect(info?.code).toBe("23505");
      expect(info?.constraint).toBe(PENDING_INVITATION_CONSTRAINT);
      expect(Object.keys(info ?? {}).every((key) => ["code", "constraint", "schema", "table", "column"].includes(key))).toBe(true);
      expect(info).not.toHaveProperty("detail");
      expect(info).not.toHaveProperty("query");
      expect(info).not.toHaveProperty("params");

      await client.query("ROLLBACK");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      await cleanupFixture(pool, ids);
      await pool.end();
    }
  });

  it("returns the canonical duplicate invitation error before the DB constraint fires", async () => {
    const pool = createLocalPool({ max: 2 });
    const ids = makeFixtureIds();

    try {
      await seedFixture(pool, ids);
      const database = drizzle(pool, { schema });
      await database.insert(schema.teamInvitations).values(directInvitation(ids));

      await expect(database.transaction((tx) => inviteTeamMemberInTx(tx, {
        teamId: ids.team,
        userId: ids.captain,
        invitedUserId: ids.invitee,
        actorId: ids.captain,
      }))).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
        message: "该邀请已存在。",
      });

      const count = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM team_invitations WHERE team_id = $1 AND invited_user_id = $2 AND status = 'pending'",
        [ids.team, ids.invitee],
      );
      expect(count.rows[0]?.count).toBe("1");
    } finally {
      await cleanupFixture(pool, ids);
      await pool.end();
    }
  });
});

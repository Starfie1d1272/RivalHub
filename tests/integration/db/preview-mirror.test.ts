import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { exportQuery } from "../../../scripts/db/preview/policy";
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
});

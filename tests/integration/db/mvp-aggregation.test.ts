import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import { readMatchMvpResults } from "../../../src/lib/matches/mvp";
import { createLocalPool } from "./harness/database";

describe("MVP candidate aggregation", () => {
  it("keeps renamed players' candidate identity together and orders tied candidates deterministically", async () => {
    const pool = createLocalPool({ max: 1 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`CREATE TEMP TABLE match_mvp_votes (
        match_id uuid NOT NULL, player_user_id uuid, player_name text NOT NULL, created_at timestamptz NOT NULL
      ) ON COMMIT DROP`);
      const matchId = randomUUID();
      const early = randomUUID();
      const later = randomUUID();
      await client.query(`INSERT INTO match_mvp_votes (match_id, player_user_id, player_name, created_at) VALUES
        ($1, $2, 'Before rename', '2026-10-01T01:00:00Z'),
        ($1, $2, 'After rename', '2026-10-01T03:00:00Z'),
        ($1, $3, 'Other player', '2026-10-01T02:00:00Z'),
        ($1, $3, 'Other player', '2026-10-01T04:00:00Z'),
        ($1, NULL, 'Legacy one', '2026-10-01T05:00:00Z'),
        ($1, NULL, 'Legacy two', '2026-10-01T06:00:00Z')`, [matchId, early, later]);

      const rows = await readMatchMvpResults(matchId, drizzle(client));
      expect(rows.map(({ playerUserId, count }) => ({ playerUserId, count }))).toEqual([
        { playerUserId: early, count: 2 },
        { playerUserId: later, count: 2 },
        { playerUserId: null, count: 1 },
        { playerUserId: null, count: 1 },
      ]);
      expect(rows.slice(2).map(row => row.playerName)).toEqual(["Legacy one", "Legacy two"]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await pool.end();
    }
  });
});

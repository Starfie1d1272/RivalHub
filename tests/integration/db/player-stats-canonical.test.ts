import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  aggregatePlayerRows,
  completeSum,
  kdaOfSums,
  killWeightedAvg,
  perRound,
  ratioOfSums,
  roundWeightedAvg,
  roundsExpr,
  simpleAvg,
  type StatRowInput,
} from "../../../src/lib/stats";
import { createLocalPool } from "./harness/database";

type FixtureRow = StatRowInput & { matchId: string; mapId: string };

function fixtureRow(overrides: Partial<FixtureRow> = {}): FixtureRow {
  return {
    userId: "00000000-0000-0000-0000-000000000001",
    perfectName: "Player",
    matchId: randomUUID(),
    mapId: randomUUID(),
    kills: null,
    deaths: null,
    assists: null,
    hsPercent: null,
    firstKills: null,
    multiKills: null,
    clutches: null,
    adr: null,
    rws: null,
    ratingPro: null,
    we: null,
    rounds: null,
    ...overrides,
  };
}

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

describe("canonical player stats PostgreSQL equivalence", () => {
  it("matches the in-memory contract for weighted, zero, unknown, and mixed-null fixtures", async () => {
    const pool = createLocalPool({ max: 1 });
    const client = await pool.connect();
    const zeroUser = "00000000-0000-0000-0000-000000000001";
    const weightedUser = "00000000-0000-0000-0000-000000000002";
    const unknownUser = "00000000-0000-0000-0000-000000000003";
    const mixedNullUser = "00000000-0000-0000-0000-000000000004";
    const mixedZeroUser = "00000000-0000-0000-0000-000000000005";
    const rows: FixtureRow[] = [
      fixtureRow({
        userId: zeroUser,
        perfectName: "Zero",
        kills: 0,
        deaths: 0,
        assists: 0,
        hsPercent: 0,
        firstKills: 0,
        multiKills: 0,
        clutches: 0,
        adr: 0,
        rws: 0,
        ratingPro: 0,
        we: 0,
        rounds: 24,
      }),
      fixtureRow({
        userId: zeroUser,
        perfectName: "Zero",
        kills: 0,
        deaths: 0,
        assists: 0,
        hsPercent: 0,
        firstKills: 0,
        multiKills: 0,
        clutches: 0,
        adr: 0,
        rws: 0,
        ratingPro: 0,
        we: 0,
        rounds: 30,
      }),
      fixtureRow({
        userId: weightedUser,
        perfectName: "Weighted",
        kills: 20,
        deaths: 10,
        assists: 5,
        hsPercent: 50,
        firstKills: 2,
        multiKills: 3,
        clutches: 1,
        adr: 90,
        rws: 12,
        ratingPro: 1.3,
        we: 9,
        rounds: 24,
      }),
      fixtureRow({
        userId: weightedUser,
        perfectName: "Weighted",
        kills: 10,
        deaths: 8,
        assists: 4,
        hsPercent: 30,
        firstKills: 1,
        multiKills: 1,
        clutches: 0,
        adr: 80,
        rws: 10,
        ratingPro: 1.1,
        we: 7,
        rounds: 30,
      }),
      fixtureRow({
        userId: unknownUser,
        perfectName: "Unknown",
      }),
      fixtureRow({
        userId: mixedNullUser,
        perfectName: "Mixed Null",
        kills: 10,
        deaths: null,
        assists: 1,
        firstKills: 2,
        multiKills: 3,
        clutches: 1,
        rounds: 24,
      }),
      fixtureRow({
        userId: mixedNullUser,
        perfectName: "Mixed Null",
        kills: null,
        deaths: 5,
        assists: 2,
        firstKills: null,
        multiKills: 1,
        clutches: null,
        rounds: 30,
      }),
      fixtureRow({
        userId: mixedZeroUser,
        perfectName: "Mixed Zero",
        kills: null,
        deaths: 0,
        assists: 0,
        rounds: 24,
      }),
      fixtureRow({
        userId: mixedZeroUser,
        perfectName: "Mixed Zero",
        kills: 0,
        deaths: 0,
        assists: 0,
        rounds: 30,
      }),
    ];

    try {
      await client.query(`
        CREATE TEMP TABLE matches (
          id uuid PRIMARY KEY,
          format text NOT NULL,
          score_a integer,
          score_b integer
        );
        CREATE TEMP TABLE match_maps (
          id uuid PRIMARY KEY,
          match_id uuid NOT NULL,
          score_a integer,
          score_b integer
        );
        CREATE TEMP TABLE match_player_stats (
          user_id uuid NOT NULL,
          match_id uuid NOT NULL,
          map_id uuid NOT NULL,
          kills integer,
          deaths integer,
          assists integer,
          hs_percent integer,
          first_kills integer,
          multi_kills integer,
          clutches integer,
          adr real,
          rws real,
          rating_pro real,
          we real
        );
      `);

      for (const row of rows) {
        await client.query(
          `INSERT INTO matches (id, format, score_a, score_b)
           VALUES ($1, 'bo3', 2, 1)
           ON CONFLICT (id) DO NOTHING`,
          [row.matchId],
        );
        const mapScore = row.rounds == null ? [null, null] : [row.rounds, 0];
        await client.query(
          `INSERT INTO match_maps (id, match_id, score_a, score_b)
           VALUES ($1, $2, $3, $4)`,
          [row.mapId, row.matchId, ...mapScore],
        );
        await client.query(
          `INSERT INTO match_player_stats (
             user_id, match_id, map_id, kills, deaths, assists, hs_percent,
             first_kills, multi_kills, clutches, adr, rws, rating_pro, we
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            row.userId,
            row.matchId,
            row.mapId,
            row.kills,
            row.deaths,
            row.assists,
            row.hsPercent,
            row.firstKills,
            row.multiKills,
            row.clutches,
            row.adr,
            row.rws,
            row.ratingPro,
            row.we,
          ],
        );
      }

      const kdaExpr = kdaOfSums("mps.kills", "mps.assists", "mps.deaths");

      const query = sql`
        SELECT
          mps.user_id,
          ${completeSum("mps.kills")} AS kills,
          ${completeSum("mps.deaths")} AS deaths,
          ${completeSum("mps.assists")} AS assists,
          ${completeSum("mps.first_kills")} AS first_kills,
          ${completeSum("mps.multi_kills")} AS multi_kills,
          ${completeSum("mps.clutches")} AS clutches,
          ${perRound("mps.kills")} AS kpr,
          ${perRound("mps.first_kills")} AS fkpr,
          ${perRound("mps.multi_kills")} AS mkpr,
          ${perRound("mps.clutches")} AS cpr,
          ${killWeightedAvg("mps.hs_percent")} AS hs_percent,
          ${roundWeightedAvg("mps.adr")} AS adr,
          ${simpleAvg("mps.rating_pro")} AS rating_pro,
          ${simpleAvg("mps.rws")} AS rws,
          ${simpleAvg("mps.we")} AS we,
          ${ratioOfSums("mps.kills", "mps.deaths")} AS kd,
          ${kdaExpr} AS kda,
          ${completeSum(roundsExpr)}::int AS total_rounds
        FROM match_player_stats mps
        JOIN matches m ON m.id = mps.match_id
        JOIN match_maps mm ON mm.id = mps.map_id
        GROUP BY mps.user_id
        ORDER BY ${simpleAvg("mps.rating_pro")} DESC NULLS LAST, mps.user_id
      `;
      const built = new PgDialect().sqlToQuery(query);
      const result = await client.query(built.sql, built.params);
      const byUserId = new Map(result.rows.map((resultRow) => [resultRow.user_id as string, resultRow]));
      expect(result.rows.map((resultRow) => resultRow.user_id)).toEqual([
        weightedUser,
        zeroUser,
        unknownUser,
        mixedNullUser,
        mixedZeroUser,
      ]);

      const rowsFor = (userId: string) => rows.filter((row) => row.userId === userId);
      const zeroAggregate = aggregatePlayerRows(rowsFor(zeroUser));
      const zeroSql = byUserId.get(zeroUser);
      expect(zeroSql).toBeDefined();
      expect(toNumber(zeroSql?.kills)).toBe(zeroAggregate.kills);
      expect(toNumber(zeroSql?.deaths)).toBe(zeroAggregate.deaths);
      expect(toNumber(zeroSql?.assists)).toBe(zeroAggregate.assists);
      expect(toNumber(zeroSql?.first_kills)).toBe(zeroAggregate.firstKills);
      expect(toNumber(zeroSql?.multi_kills)).toBe(zeroAggregate.multiKills);
      expect(toNumber(zeroSql?.clutches)).toBe(zeroAggregate.clutches);
      expect(toNumber(zeroSql?.kpr)).toBe(zeroAggregate.kpr);
      expect(toNumber(zeroSql?.kd)).toBe(zeroAggregate.kd);
      expect(toNumber(zeroSql?.hs_percent)).toBe(zeroAggregate.hsPercent);
      expect(toNumber(zeroSql?.adr)).toBe(zeroAggregate.adr);
      expect(toNumber(zeroSql?.rating_pro)).toBe(zeroAggregate.ratingPro);
      expect(toNumber(zeroSql?.total_rounds)).toBe(zeroAggregate.totalRounds);

      const weightedAggregate = aggregatePlayerRows(rowsFor(weightedUser));
      const weightedSql = byUserId.get(weightedUser);
      expect(weightedSql).toBeDefined();
      expect(toNumber(weightedSql?.kpr)).toBeCloseTo(weightedAggregate.kpr!, 5);
      expect(toNumber(weightedSql?.kills)).toBe(weightedAggregate.kills);
      expect(toNumber(weightedSql?.deaths)).toBe(weightedAggregate.deaths);
      expect(toNumber(weightedSql?.assists)).toBe(weightedAggregate.assists);
      expect(toNumber(weightedSql?.fkpr)).toBeCloseTo(weightedAggregate.fkpr!, 5);
      expect(toNumber(weightedSql?.hs_percent)).toBeCloseTo(weightedAggregate.hsPercent!, 5);
      expect(toNumber(weightedSql?.adr)).toBeCloseTo(weightedAggregate.adr!, 5);
      expect(toNumber(weightedSql?.rating_pro)).toBeCloseTo(weightedAggregate.ratingPro!, 5);
      expect(toNumber(weightedSql?.rws)).toBeCloseTo(weightedAggregate.rws!, 5);
      expect(toNumber(weightedSql?.we)).toBeCloseTo(weightedAggregate.we!, 5);
      expect(toNumber(weightedSql?.kd)).toBeCloseTo(weightedAggregate.kd!, 5);
      expect(toNumber(weightedSql?.kda)).toBeCloseTo(
        (weightedAggregate.kills! + weightedAggregate.assists!) / weightedAggregate.deaths!,
        5,
      );
      expect(toNumber(weightedSql?.total_rounds)).toBe(weightedAggregate.totalRounds);

      const unknownSql = byUserId.get(unknownUser);
      expect(unknownSql).toBeDefined();
      expect(toNumber(unknownSql?.kills)).toBeNull();
      expect(toNumber(unknownSql?.deaths)).toBeNull();
      expect(toNumber(unknownSql?.kda)).toBeNull();
      expect(toNumber(unknownSql?.kpr)).toBeNull();
      expect(toNumber(unknownSql?.hs_percent)).toBeNull();
      expect(toNumber(unknownSql?.adr)).toBeNull();
      expect(toNumber(unknownSql?.total_rounds)).toBeNull();

      const mixedNullAggregate = aggregatePlayerRows(rowsFor(mixedNullUser));
      const mixedNullSql = byUserId.get(mixedNullUser);
      expect(mixedNullSql).toBeDefined();
      expect(toNumber(mixedNullSql?.kills)).toBeNull();
      expect(toNumber(mixedNullSql?.deaths)).toBeNull();
      expect(toNumber(mixedNullSql?.first_kills)).toBeNull();
      expect(toNumber(mixedNullSql?.multi_kills)).toBe(4);
      expect(toNumber(mixedNullSql?.clutches)).toBeNull();
      expect(toNumber(mixedNullSql?.kda)).toBeNull();
      expect(toNumber(mixedNullSql?.kd)).toBeNull();
      expect(toNumber(mixedNullSql?.kpr)).toBeCloseTo(mixedNullAggregate.kpr!, 5);
      expect(toNumber(mixedNullSql?.fkpr)).toBeCloseTo(mixedNullAggregate.fkpr!, 5);
      expect(toNumber(mixedNullSql?.mkpr)).toBeCloseTo(mixedNullAggregate.mkpr!, 5);
      expect(toNumber(mixedNullSql?.cpr)).toBeCloseTo(mixedNullAggregate.cpr!, 5);
      expect(toNumber(mixedNullSql?.total_rounds)).toBe(mixedNullAggregate.totalRounds);

      const mixedZeroAggregate = aggregatePlayerRows(rowsFor(mixedZeroUser));
      const mixedZeroSql = byUserId.get(mixedZeroUser);
      expect(mixedZeroSql).toBeDefined();
      expect(toNumber(mixedZeroSql?.kills)).toBeNull();
      expect(toNumber(mixedZeroSql?.deaths)).toBe(mixedZeroAggregate.deaths);
      expect(toNumber(mixedZeroSql?.kda)).toBeNull();
      expect(toNumber(mixedZeroSql?.kpr)).toBe(mixedZeroAggregate.kpr);
      expect(toNumber(mixedZeroSql?.total_rounds)).toBe(mixedZeroAggregate.totalRounds);
    } finally {
      client.release();
      await pool.end();
    }
  });
});

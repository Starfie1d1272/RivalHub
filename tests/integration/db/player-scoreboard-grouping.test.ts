import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, it } from "vitest";
import { getPlayerStatsScoreboards, getStatsLeaderboard, type StatsLeaderboardFilters } from "@/lib/stats/leaderboard-query";
import type { EffectiveMatchRosterPlayer } from "@/lib/match-rosters/effective";
import * as schema from "@/db/schema";
import { createLocalPool } from "./harness/database";

it("preserves weighted, nullable and current-import overall/map scoreboards in one PG read", async () => {
  const pool = createLocalPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Session-local tables retain the actual PG column types without changing
    // canonical facts, active fixtures or another worker's database rows.
    for (const table of ["match_player_stats", "matches", "match_maps", "users", "steam_profiles", "competition_entries"]) {
      await client.query(`CREATE TEMP TABLE ${table} ON COMMIT DROP AS SELECT * FROM public.${table} WITH NO DATA`);
    }
    const userId = randomUUID();
    const seasonId = randomUUID();
    const matchId = randomUUID();
    const testMatchId = randomUUID();
    const entryId = randomUUID();
    const importId = randomUUID();
    await client.query("INSERT INTO users (id, display_name) VALUES ($1, 'Weighted player')", [userId]);
    await client.query("INSERT INTO competition_entries (id, name) VALUES ($1, 'Entry')", [entryId]);
    await client.query("INSERT INTO matches (id, season_id, test_config) VALUES ($1,$3,NULL),($2,$3,'{}'::jsonb)", [matchId, testMatchId, seasonId]);
    const fixtures = [
      { map: "de_mirage", rounds: 20, kills: 10, deaths: 5, adr: 100, hs: 50, rating: 1 },
      { map: "de_inferno", rounds: 30, kills: 30, deaths: 10, adr: 50, hs: 20, rating: null },
      { map: "de_mirage", rounds: 10, kills: 0, deaths: 0, adr: null, hs: null, rating: 2 },
      { map: "de_inferno", rounds: 20, kills: 99, deaths: 1, adr: 999, hs: 99, rating: 9, stale: true },
      { map: "de_inferno", rounds: 20, kills: 99, deaths: 1, adr: 999, hs: 99, rating: 9, incomplete: true },
      { map: "de_inferno", rounds: 20, kills: 7, deaths: 3, adr: 70, hs: 30, rating: 1, test: true },
    ];
    for (const fixture of fixtures) {
      const mapId = randomUUID();
      const targetMatchId = fixture.test ? testMatchId : matchId;
      await client.query("INSERT INTO match_maps (id,match_id,map_name,score_a,score_b,completed_at) VALUES ($1,$2,$3,10,$4,$5)",
        [mapId, targetMatchId, fixture.map, fixture.rounds - 10, fixture.incomplete ? null : new Date()]);
      await client.query(`INSERT INTO match_player_stats (id,match_id,map_id,user_id,verified_by_admin,dak_import_id,kills,deaths,adr,hs_percent,rating_pro)
        VALUES ($1,$2,$3,$4::uuid,$4::text,$5,$6,$7,$8,$9,$10)`,
      [randomUUID(), targetMatchId, mapId, userId, fixture.stale ? randomUUID() : importId, fixture.kills, fixture.deaths, fixture.adr, fixture.hs, fixture.rating]);
    }
    const roster: EffectiveMatchRosterPlayer[] = [matchId, testMatchId].map(id => ({
      matchId: id, userId, entryId, rosterId: randomUUID(), eventRosterMemberId: randomUUID(),
      steam64: null, displayName: "Weighted player", personaName: null, perfectName: null, isStarter: true,
    }));
    const queries: string[] = [];
    const database = drizzle(client, { schema, logger: { logQuery(query) { queries.push(query); } } });
    const options = { userId, requireCurrentImports: true, requireRosterMatch: true };
    for (const scope of [{ seasonId }, { seasonId, mapFilter: "de_mirage" }, { seasonId, teamFilter: randomUUID() }] satisfies StatsLeaderboardFilters[]) {
      const expected = {
        scoreboard: await getStatsLeaderboard(scope, [importId], roster, database, { ...options, groupByTeam: false }),
        scoreboardMaps: await getStatsLeaderboard(scope, [importId], roster, database, { ...options, groupByTeam: false, groupByMap: true }),
      };
      queries.length = 0;
      const actual = await getPlayerStatsScoreboards(scope, [importId], roster, database, options);
      expect(actual).toEqual(expected);
      expect(queries).toHaveLength(1);
    }
    const overall = (await getPlayerStatsScoreboards({ seasonId }, [importId], roster, database, options)).scoreboard[0]!;
    expect(overall).toMatchObject({ maps: 3, rounds: 60, avgAdr: 70, avgHs: 27.5, avgRating: 1.5, ratingSamples: 2, kast: null });
    expect(overall.kpr).toBeCloseTo(40 / 60);
    expect(overall.kdRatio).toBeCloseTo(40 / 15);
    expect(await getPlayerStatsScoreboards({ seasonId }, [], roster, database, options)).toEqual({ scoreboard: [], scoreboardMaps: [] });
    expect(await getPlayerStatsScoreboards({ seasonId }, [importId], [], database, options)).toEqual({ scoreboard: [], scoreboardMaps: [] });
    const includedTest = await getPlayerStatsScoreboards({ seasonId }, [importId], roster, database, { ...options, includeTestMatch: true });
    expect(includedTest.scoreboard[0]?.maps).toBe(4);
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});

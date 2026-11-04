import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { createLocalPool } from "./harness/database";

const state = vi.hoisted(() => ({ database: null as unknown }));
vi.mock("@/db/client", () => ({ db: new Proxy({}, { get: (_, key) => Reflect.get(state.database as object, key) }) }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));
// Statistics arithmetic and identity merge have independent real-PG contracts.
// This test isolates fresh profile SQL and its request composition from Next cache.
vi.mock("@/lib/stats/cached-query", () => ({ getPublicPlayerCareerDetail: async () => null }));
vi.mock("@/lib/seasons/public-results", () => ({ getPublicSeasonResultsBatch: async (seasons: { id: string }[]) => new Map(seasons.map(season => [season.id, { placements: [], honors: [], honorHistory: [] }])) }));
vi.mock("@/lib/observability/server", () => ({ captureException: () => {} }));

import { createPublicPlayerProfileSections } from "@/lib/players/public-profile";
import { getPublicPlayerMatches, getRecentPublicPlayerMatches } from "@/lib/players/public-matches";

it("keeps fresh education/entry withdrawal and multi-event history in independently consumed PG sections", async () => {
  const pool = createLocalPool();
  const client = await pool.connect();
  const queries: string[] = [];
  try {
    await client.query("BEGIN");
    for (const table of ["event_roster_members", "event_rosters", "competition_entries", "seasons", "education_verifications", "institutions"]) {
      await client.query(`CREATE TEMP TABLE ${table} ON COMMIT DROP AS SELECT * FROM public.${table} WITH NO DATA`);
    }
    state.database = drizzle(client, { schema, logger: { logQuery(query) { queries.push(query); } } });
    const userId = randomUUID();
    const institutionId = randomUUID();
    await client.query("INSERT INTO institutions (id,name) VALUES ($1,'Local public university')", [institutionId]);
    await client.query("INSERT INTO education_verifications (id,user_id,institution_id,status,academic_status,submitted_at) VALUES ($1,$2,$3,'approved','enrolled',now())", [randomUUID(), userId, institutionId]);
    for (const [index, status] of ["archived", "playing"].entries()) {
      const seasonId = randomUUID();
      const entryId = randomUUID();
      const rosterId = randomUUID();
      await client.query("INSERT INTO seasons (id,name,slug,status,created_at) VALUES ($1,$2,$2,$3,now())", [seasonId, `event-${index}`, status]);
      await client.query("INSERT INTO competition_entries (id,competition_id,name,registration_status) VALUES ($1,$2,$3,'approved')", [entryId, seasonId, `Entry ${index}`]);
      await client.query("INSERT INTO event_rosters (id,entry_id,status) VALUES ($1,$2,'frozen')", [rosterId, entryId]);
      await client.query("INSERT INTO event_roster_members (id,event_roster_id,user_id,is_current) VALUES ($1,$2,$3,true)", [randomUUID(), rosterId, userId]);
    }
    const known = { user: { id: userId }, sanctions: [] } as unknown as Parameters<typeof createPublicPlayerProfileSections>[0];
    const read = async () => {
      const sections = createPublicPlayerProfileSections(known);
      const [basic, history, overview, performance, attributes] = await Promise.all([
        sections.basic, sections.history, sections.overview, sections.performance, sections.attributes(),
      ]);
      return { basic, history, overview, performance, attributes };
    };
    const before = await read();
    expect(before.basic.publicEducationIdentities).toEqual([{ institutionName: "Local public university", academicStatus: "在读", verificationLabel: "已认证" }]);
    expect(before.basic.eventTeams).toHaveLength(2);
    expect(before.basic.currentEventTeams).toHaveLength(1);
    expect(before.history.careerHistory).toMatchObject([{ seasonSlug: "event-0", teamName: "Entry 0", record: { played: 0 } }]);
    expect(before.performance.statsUnavailable).toBe(true);
    expect(before.attributes).toEqual({ attributes: null, benchmarkUnavailable: false });
    expect(queries.filter(query => query.includes('from "event_roster_members"'))).toHaveLength(1);
    await client.query("UPDATE education_verifications SET status='rejected'");
    await client.query("UPDATE competition_entries SET registration_status='withdrawn'");
    const after = await read();
    expect(after.basic.publicEducationIdentities).toEqual([]);
    expect(after.basic.eventTeams).toEqual([]);
    expect(after.history.careerHistory).toEqual([]);
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});


it("retains series-only appearances and publishes only reviewed personal maps from historical lineups", async () => {
  const pool = createLocalPool();
  const client = await pool.connect();
  const tables = ["match_roster_players", "match_rosters", "event_roster_members", "event_rosters", "matches", "seasons", "competition_entries", "match_maps", "match_player_stats"];
  try {
    // The reader owns its repeatable-read transaction. Session-local tables
    // persist across its commits and never mutate shared public fixtures.
    for (const table of tables) {
      await client.query(`CREATE TEMP TABLE ${table} AS SELECT * FROM public.${table} WITH NO DATA`);
    }
    state.database = drizzle(client, { schema });
    const [userId, otherUserId, seasonId, entryA, entryB, eventRosterId, eventMemberId, rosterId, matchId, firstMap, secondMap, unplayedMap] = Array.from({ length: 12 }, () => randomUUID());
    await client.query("INSERT INTO seasons (id,name,slug,status) VALUES ($1,'Ongoing public event','history-scope','playing')", [seasonId]);
    await client.query("INSERT INTO competition_entries (id,name) VALUES ($1,'Historical team'),($2,'Opponent')", [entryA, entryB]);
    await client.query("INSERT INTO event_rosters (id,entry_id,status) VALUES ($1,$2,'frozen')", [eventRosterId, entryA]);
    await client.query("INSERT INTO event_roster_members (id,event_roster_id,user_id,is_current) VALUES ($1,$2,$3,false)", [eventMemberId, eventRosterId, userId]);
    await client.query("INSERT INTO match_rosters (id,match_id,entry_id,status) VALUES ($1,$2,$3,'confirmed')", [rosterId, matchId, entryA]);
    await client.query("INSERT INTO match_roster_players (roster_id,event_roster_member_id,is_starter) VALUES ($1,$2,true)", [rosterId, eventMemberId]);
    await client.query(`INSERT INTO matches (id,season_id,entry_a_id,entry_b_id,status,score_a,score_b,is_forfeit,completed_at)
      VALUES ($1,$2,$3,$4,'finished',2,0,false,'2026-11-04 01:02:03.123456+00')`, [matchId, seasonId, entryA, entryB]);
    await client.query(`INSERT INTO match_maps (id,match_id,map_name,map_order,score_a,score_b,completed_at)
      VALUES ($1,$4,'de_mirage',1,13,8,now()),($2,$4,'de_inferno',2,13,10,now()),($3,$4,'de_nuke',3,NULL,NULL,NULL)`, [firstMap, secondMap, unplayedMap, matchId]);
    const query = { event: "", map: "", page: 1, cursor: "", direction: "older" as const };
    const seriesOnly = await getPublicPlayerMatches(userId, query);
    expect(seriesOnly.matches).toMatchObject([{ id: matchId, teamName: "Historical team", ownScore: 2, opponentScore: 0,
      completedMaps: 2, confirmedMaps: 0, maps: [], cursor: `2026-11-04T01:02:03.123456Z|${matchId}` }]);
    expect(seriesOnly.matches).toHaveLength(1);
    expect((await getRecentPublicPlayerMatches(userId)).map(match => match.id)).toEqual([matchId]);
    expect((await getPublicPlayerMatches(userId, { ...query, map: "de_mirage" })).matches).toEqual([]);

    // Nonempty userId is insufficient: one row is unreviewed, another belongs
    // to someone else, and the deciding map has never actually been completed.
    const firstStat = randomUUID();
    await client.query(`INSERT INTO match_player_stats (id,match_id,map_id,user_id,perfect_name,verified_by_admin,kills,deaths)
      VALUES ($1,$2,$3,$6,'Reviewed later',NULL,0,3),($8,$2,$4,$7,'Other player','reviewer',20,10),($9,$2,$5,$6,'Unplayed map','reviewer',0,0)`,
    [firstStat, matchId, firstMap, secondMap, unplayedMap, userId, otherUserId, randomUUID(), randomUUID()]);
    expect((await getPublicPlayerMatches(userId, query)).matches[0]).toMatchObject({ maps: [], confirmedMaps: 0 });
    await client.query("UPDATE match_player_stats SET verified_by_admin='reviewer' WHERE id=$1", [firstStat]);
    const partial = await getPublicPlayerMatches(userId, query);
    expect(partial.matches[0]).toMatchObject({ completedMaps: 2, confirmedMaps: 1,
      maps: [{ id: firstMap, name: "de_mirage", order: 1, kills: 0, deaths: 3, adr: null, rating: null }] });
    expect(partial.matches[0]?.maps).toHaveLength(1);
    expect((await getPublicPlayerMatches(userId, { ...query, map: "de_mirage" })).matches[0]).toMatchObject({ id: matchId, ownScore: 2, opponentScore: 0 });
    expect((await getPublicPlayerMatches(userId, { ...query, map: "de_inferno" })).matches).toEqual([]);
    expect((await getPublicPlayerMatches(userId, { ...query, map: "de_nuke" })).matches).toEqual([]);
  } finally {
    for (const table of tables) await client.query(`DROP TABLE IF EXISTS pg_temp.${table}`);
    client.release();
    await pool.end();
  }
});

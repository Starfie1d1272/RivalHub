import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { PERFECT_WORLD_RANK_ORDER } from "../../../src/lib/config/perfect-world";
import { capturePostgresError, localDatabaseUrl } from "./harness/database";

const databaseUrl = localDatabaseUrl();

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 1 });
  const client = await pool.connect();
  const ids = { first: randomUUID(), second: randomUUID(), legacy: randomUUID() };

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO users (id, email, perfect_name)
       VALUES ($1, $2, $3), ($4, $5, $6)`,
      [ids.first, `profile-first-${ids.first}@local.test`, "Display Nick", ids.second, `profile-second-${ids.second}@local.test`, "Second Nick"],
    );
    await client.query(
      `INSERT INTO users (id, email, perfect_name) VALUES ($1, $2, $3)`,
      [ids.legacy, `profile-legacy-${ids.legacy}@local.test`, "Legacy Nick"],
    );
    const identity = await client.query<{ perfect_name: string | null }>(
      `SELECT perfect_name FROM users WHERE id = $1`,
      [ids.legacy],
    );
    expect(identity.rows[0]).toEqual({ perfect_name: "Legacy Nick" });

    await client.query(
      `INSERT INTO competitive_platforms (key, display_name, rating_label) VALUES ('perfect_world', '完美世界竞技平台', 'Rating Pro')
       ON CONFLICT (key) DO NOTHING`,
    );
    await client.query(
      `INSERT INTO competitive_platform_ranks (platform_key, rank_key, label, sort_order)
       SELECT 'perfect_world', value, value, ordinality - 1
       FROM unnest($1::text[]) WITH ORDINALITY AS t(value, ordinality)
       ON CONFLICT (platform_key, rank_key) DO NOTHING`,
      [PERFECT_WORLD_RANK_ORDER],
    );
    await client.query(
      `INSERT INTO competitive_platform_seasons (platform, season_key, label, sort_order)
       VALUES ('perfect_world', 'major-previous', 'Major Previous', 0), ('perfect_world', 'major-current', 'Major Current', 1)
       ON CONFLICT (platform, season_key) DO NOTHING`,
    );
    const duplicatePlatformSeason = await capturePostgresError(client, () => client.query(
      `INSERT INTO competitive_platform_seasons (platform, season_key, label)
       VALUES ('perfect_world', 'major-current', 'Duplicate')`,
      [],
    ));
    expect(duplicatePlatformSeason).toMatchObject({ code: "23505" });
    await client.query(
      `INSERT INTO competitive_rank_facts (user_id, platform, kind, platform_season_key, rank, rating)
       VALUES ($1, 'perfect_world', 'historical_peak', NULL, $2, 1000),
              ($1, 'perfect_world', 'season_peak', 'major-previous', $3, 900),
              ($1, 'perfect_world', 'season_peak', 'major-current', $4, 1100)`,
      [ids.first, PERFECT_WORLD_RANK_ORDER[7], PERFECT_WORLD_RANK_ORDER[4], PERFECT_WORLD_RANK_ORDER[10]],
    );
    const duplicateRankFact = await capturePostgresError(client, () => client.query(
      `INSERT INTO competitive_rank_facts (user_id, platform, kind, platform_season_key, rank, rating)
       VALUES ($1, 'perfect_world', 'season_peak', 'major-current', $2, 1200)`,
      [ids.first, PERFECT_WORLD_RANK_ORDER[11]],
    ));
    expect(duplicateRankFact).toMatchObject({ code: "23505" });
    await client.query(
      `UPDATE competitive_rank_facts
       SET rank = 'S+', rating = 1200, updated_at = now()
       WHERE user_id = $1 AND platform = 'perfect_world' AND kind = 'season_peak' AND platform_season_key = 'major-current'`,
      [ids.first],
    );
    const factCount = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM competitive_rank_facts WHERE user_id = $1`,
      [ids.first],
    );
    expect(factCount.rows[0]?.count).toBe("3");

    // Exact stars are an independent fact column: legacy facts above stay NULL,
    // new star facts must be non-negative integers at the database level.
    const legacyStars = await client.query<{ stars: number | null }>(
      `SELECT stars FROM competitive_rank_facts WHERE user_id = $1`,
      [ids.first],
    );
    expect(legacyStars.rows.every((row) => row.stars === null)).toBe(true);
    await client.query(
      `INSERT INTO competitive_rank_facts (user_id, platform, kind, platform_season_key, rank, rating, stars)
       VALUES ($1, 'perfect_world', 'season_peak', 'major-previous', '青铜S', 800, 7)`,
      [ids.second],
    );
    const negativeStars = await capturePostgresError(client, () => client.query(
      `INSERT INTO competitive_rank_facts (user_id, platform, kind, platform_season_key, rank, rating, stars)
       VALUES ($1, 'perfect_world', 'historical_peak', NULL, '黄金S', 900, -3)`,
      [ids.second],
    ));
    expect(negativeStars).toMatchObject({ code: "23514" });

    // 2.x distinguishes an explicit unranked declaration from no fact row;
    // only the declared shape may omit rank/stars, and historical peak remains
    // a ranked provenance-bearing fact.
    await client.query(
      `INSERT INTO competitive_rank_facts (user_id, platform, kind, platform_season_key, status, rank, rating, stars)
       VALUES ($1, 'perfect_world', 'season_peak', 'major-current', 'unranked', NULL, NULL, NULL)`,
      [ids.second],
    );
    const invalidUnranked = await capturePostgresError(client, () => client.query(
      `INSERT INTO competitive_rank_facts (user_id, platform, kind, platform_season_key, status, rank, rating)
       VALUES ($1, 'perfect_world', 'season_peak', 'major-current', 'unranked', 'A', 1000)`,
      [ids.legacy],
    ));
    expect(invalidUnranked).toMatchObject({ code: "23514" });
    const invalidHistoricalUnranked = await capturePostgresError(client, () => client.query(
      `INSERT INTO competitive_rank_facts (user_id, platform, kind, status, rank, rating)
       VALUES ($1, 'perfect_world', 'historical_peak', 'unranked', NULL, NULL)`,
      [ids.legacy],
    ));
    expect(invalidHistoricalUnranked).toMatchObject({ code: "23514" });

    const protectedTables = await client.query<{ relrowsecurity: boolean; anon_select: boolean; authenticated_select: boolean }>(
      `SELECT c.relrowsecurity,
              has_table_privilege('anon', 'public.' || c.relname, 'SELECT') AS anon_select,
              has_table_privilege('authenticated', 'public.' || c.relname, 'SELECT') AS authenticated_select
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname IN ('competitive_platforms', 'competitive_platform_ranks', 'competitive_platform_seasons', 'competitive_rank_facts')
       ORDER BY c.relname`,
    );
    expect(protectedTables.rows).toHaveLength(4);
    for (const table of protectedTables.rows) {
      expect(table.relrowsecurity).toBe(true);
      expect(table.anon_select).toBe(false);
      expect(table.authenticated_select).toBe(false);
    }

    await client.query("ROLLBACK");
    console.log("Major profile Local PostgreSQL integration suite passed.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

describe("Major competitive profile PostgreSQL invariants", () => {
  it("preserves canonical profile facts and protected public boundaries", async () => {
    await main();
  });
});

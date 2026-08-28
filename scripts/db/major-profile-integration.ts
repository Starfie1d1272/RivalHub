import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { Pool, type PoolClient } from "pg";
import { PERFECT_WORLD_RANK_ORDER } from "../../src/lib/config/perfect-world";

const databaseUrl = process.env.RIVALHUB_LOCAL_DATABASE_URL;
if (!databaseUrl) throw new Error("RIVALHUB_LOCAL_DATABASE_URL 未设置。");
const target = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname)) {
  throw new Error("Major profile 集成测试只允许 Local Supabase loopback 数据库。");
}

async function expectPgError(client: PoolClient, query: string, values: unknown[], code: string): Promise<void> {
  const savepoint = `expected_profile_error_${randomUUID().replaceAll("-", "")}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await client.query(query, values);
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    assert.equal((error as { code?: string }).code, code);
    return;
  }
  throw new Error(`预期 PostgreSQL 错误 ${code}，但操作成功。`);
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 1 });
  const client = await pool.connect();
  const ids = { first: randomUUID(), second: randomUUID(), legacy: randomUUID(), emptyA: randomUUID(), emptyB: randomUUID() };

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO users (id, email, perfect_name, perfect_id)
       VALUES ($1, $2, $3, $4)`,
      [ids.first, `profile-first-${ids.first}@local.test`, "Display Nick", "  Pw-Major-01  "],
    );
    await expectPgError(
      client,
      `INSERT INTO users (id, email, perfect_id) VALUES ($1, $2, $3)`,
      [ids.second, `profile-second-${ids.second}@local.test`, "pw-major-01"],
      "23505",
    );

    await client.query(`UPDATE users SET perfect_id = $2 WHERE id = $1`, [ids.first, " PW-Major-02 "]);
    await client.query(
      `INSERT INTO users (id, email, perfect_id) VALUES ($1, $2, $3)`,
      [ids.second, `profile-second-${ids.second}@local.test`, "pw-major-01"],
    );
    await client.query(
      `INSERT INTO users (id, email, perfect_id) VALUES ($1, $2, NULL), ($3, $4, NULL)`,
      [ids.emptyA, `profile-empty-a-${ids.emptyA}@local.test`, ids.emptyB, `profile-empty-b-${ids.emptyB}@local.test`],
    );
    await client.query(
      `INSERT INTO users (id, email, perfect_name) VALUES ($1, $2, $3)`,
      [ids.legacy, `profile-legacy-${ids.legacy}@local.test`, "Legacy Nick"],
    );
    const identity = await client.query<{ perfect_name: string | null; perfect_id: string | null }>(
      `SELECT perfect_name, perfect_id FROM users WHERE id = $1`,
      [ids.legacy],
    );
    assert.deepEqual(identity.rows[0], { perfect_name: "Legacy Nick", perfect_id: null });

    await client.query(
      `INSERT INTO competitive_platform_seasons (platform, season_key, label, rank_order)
       VALUES ('perfect_world', 'major-current', 'Major Current', $1::json)`,
      [JSON.stringify(PERFECT_WORLD_RANK_ORDER)],
    );
    await expectPgError(
      client,
      `INSERT INTO competitive_platform_seasons (platform, season_key, label)
       VALUES ('perfect_world', 'major-current', 'Duplicate')`,
      [],
      "23505",
    );
    await client.query(
      `INSERT INTO competitive_rank_facts (user_id, platform, kind, platform_season_key, rank, rating)
       VALUES ($1, 'perfect_world', 'historical_peak', NULL, $2, 1000),
              ($1, 'perfect_world', 'season_peak', 'major-previous', $3, 900),
              ($1, 'perfect_world', 'season_peak', 'major-current', $4, 1100)`,
      [ids.first, PERFECT_WORLD_RANK_ORDER[7], PERFECT_WORLD_RANK_ORDER[4], PERFECT_WORLD_RANK_ORDER[10]],
    );
    await expectPgError(
      client,
      `INSERT INTO competitive_rank_facts (user_id, platform, kind, platform_season_key, rank, rating)
       VALUES ($1, 'perfect_world', 'season_peak', 'major-current', $2, 1200)`,
      [ids.first, PERFECT_WORLD_RANK_ORDER[11]],
      "23505",
    );
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
    assert.equal(factCount.rows[0]?.count, "3");

    const protectedTables = await client.query<{ relrowsecurity: boolean; anon_select: boolean; authenticated_select: boolean }>(
      `SELECT c.relrowsecurity,
              has_table_privilege('anon', 'public.' || c.relname, 'SELECT') AS anon_select,
              has_table_privilege('authenticated', 'public.' || c.relname, 'SELECT') AS authenticated_select
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname IN ('competitive_platform_seasons', 'competitive_rank_facts')
       ORDER BY c.relname`,
    );
    assert.equal(protectedTables.rows.length, 2);
    for (const table of protectedTables.rows) {
      assert.equal(table.relrowsecurity, true);
      assert.equal(table.anon_select, false);
      assert.equal(table.authenticated_select, false);
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

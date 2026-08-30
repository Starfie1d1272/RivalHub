import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../src/db/schema";
import { assertPlatformRanksMutable, loadReferencedPlatformRankKeys } from "../../src/lib/competitive/catalog";

const databaseUrl = process.env.RIVALHUB_LOCAL_DATABASE_URL;
if (!databaseUrl) throw new Error("RIVALHUB_LOCAL_DATABASE_URL 未设置。");
const target = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname)) {
  throw new Error("Competitive catalog 集成测试只允许 Local Supabase loopback 数据库。");
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 1 });
  const client = await pool.connect();
  const platform = `catalog_test_${randomUUID().replaceAll("-", "")}`;
  const userId = randomUUID();
  const seasonId = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO competitive_platforms (key, display_name, rating_label) VALUES ($1, 'Catalog test', 'Rating')", [platform]);
    await client.query("INSERT INTO users (id, email) VALUES ($1, $2)", [userId, `${platform}@local.test`]);
    await client.query(
      "INSERT INTO competitive_rank_facts (user_id, platform, kind, rank, rating) VALUES ($1, $2, 'historical_peak', 'C+', 1234)",
      [userId, platform],
    );
    await client.query(
      `INSERT INTO seasons (id, slug, name, kind, status, team_registration_config)
       VALUES ($1, $2, 'Catalog frozen fixture', 'Major', 'registration', $3::json)`,
      [seasonId, `catalog-frozen-${seasonId}`, JSON.stringify({ competitiveProfile: { platform, rankOrder: ["C++", "青铜S"] } })],
    );

    const executor = drizzle(client, { schema });
    const referenced = await loadReferencedPlatformRankKeys(executor, platform);
    assert.deepEqual([...referenced].sort(), ["C+", "C++", "青铜S"].sort());
    await assert.rejects(
      () => assertPlatformRanksMutable(executor, platform, ["C++"]),
      /已被竞技资料或已发布赛事冻结的段位顺序引用/,
    );
    await assert.doesNotReject(() => assertPlatformRanksMutable(executor, platform, ["unreferenced"]));

    // Star metadata shape is enforced by the database: no starMax without a
    // starMin, no descending range, no negative fact stars.
    const savepoint = `catalog_stars_${randomUUID().replaceAll("-", "")}`;
    const expectCheckViolation = async (query: string, values: unknown[]) => {
      await client.query(`SAVEPOINT ${savepoint}`);
      try {
        await client.query(query, values);
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        assert.equal((error as { code?: string }).code, "23514");
        return;
      }
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      assert.fail(`预期 CHECK 约束拒绝，但操作成功：${query}`);
    };
    await expectCheckViolation(
      "INSERT INTO competitive_platform_ranks (platform_key, rank_key, label, sort_order, star_min, star_max) VALUES ($1, 'bad-shape', 'bad-shape', 99, NULL, 5)",
      [platform],
    );
    await expectCheckViolation(
      "INSERT INTO competitive_platform_ranks (platform_key, rank_key, label, sort_order, star_min, star_max) VALUES ($1, 'bad-order', 'bad-order', 99, 24, 10)",
      [platform],
    );
    await expectCheckViolation(
      "INSERT INTO competitive_rank_facts (user_id, platform, kind, rank, rating, stars) VALUES ($1, $2, 'historical_peak', 'C+', 1234, -1)",
      [userId, platform],
    );

    await client.query("ROLLBACK");
    console.log("Competitive catalog Local PostgreSQL integration passed: JSON frozen-rank guard and fact references execute against real PostgreSQL.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void main().catch((error) => { console.error(error); process.exit(1); });

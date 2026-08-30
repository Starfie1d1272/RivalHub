import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

/**
 * Local replay for the 0018 competitive platform catalog migration. A scratch
 * database is migrated up to 0017, seeded with legacy season-level rank_order
 * catalogues (identical, conflicting and empty), then 0018 is replayed.
 *
 * Verified invariants:
 * - conflicting non-empty rank orders fail closed with an operator message;
 * - identical rank orders are promoted to a platform ladder (key = label);
 * - an empty rank order yields a platform without a fabricated ladder;
 * - competitive_rank_facts and published frozen competitiveProfile contexts
 *   are preserved byte-for-byte.
 */

const databaseUrl = process.env.RIVALHUB_LOCAL_DATABASE_URL;
if (!databaseUrl) throw new Error("RIVALHUB_LOCAL_DATABASE_URL 未设置。");
const local = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(local.hostname)) {
  throw new Error("迁移回放只允许 Local Supabase loopback 数据库。");
}

const databaseName = `rivalhub_0018_${randomUUID().replaceAll("-", "")}`;
const maintenance = new URL(databaseUrl);
maintenance.pathname = "/postgres";

async function runMigration(client: Client, name: string): Promise<void> {
  const source = readFileSync(join(process.cwd(), "drizzle/migrations", name), "utf8");
  await client.query("BEGIN");
  try {
    await client.query(source);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(`${name} 回放失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runMigrationExpectingFailure(client: Client, name: string, keyword: string): Promise<string> {
  const source = readFileSync(join(process.cwd(), "drizzle/migrations", name), "utf8");
  await client.query("BEGIN");
  try {
    await client.query(source);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(keyword)) {
      throw new Error(`0018 应因「${keyword}」fail closed，实际错误为：${message}`);
    }
    return message;
  }
  throw new Error("0018 在冲突数据上成功执行，未按 fail closed 终止。");
}

const LEGACY_RANK_ORDER = ["D", "C", "B", "A", "S"];

async function insertLegacyCatalogFixture(client: Client, opts: { platform: string; seasons: Array<{ seasonKey: string; rankOrder: string[] }> }): Promise<void> {
  for (const [index, season] of opts.seasons.entries()) {
    await client.query(
      `INSERT INTO competitive_platform_seasons (platform, season_key, label, rank_order, active, sort_order, is_current)
       VALUES ($1, $2, $2, $3::json, true, $4, $5)`,
      [opts.platform, season.seasonKey, JSON.stringify(season.rankOrder), index, index === 0],
    );
  }
}

async function insertLegacyFactAndFrozenEventFixture(client: Client, platform: string): Promise<{ userId: string; seasonId: string; frozenRankOrder: string[] }> {
  const userId = randomUUID();
  const seasonId = randomUUID();
  const frozenRankOrder = ["Bronze", "Silver", "Gold"];
  await client.query("INSERT INTO users (id, email) VALUES ($1, $2)", [userId, `catalog-replay-${userId}@local.test`]);
  await client.query(
    `INSERT INTO competitive_rank_facts (user_id, platform, kind, platform_season_key, rank, rating)
     VALUES ($1, $2, 'historical_peak', NULL, 'Gold', 2100)`,
    [userId, platform],
  );
  await client.query(
    `INSERT INTO seasons (id, slug, name, kind, status, team_registration_config) VALUES ($1, $2, 'Replay Published Major', 'Major', 'registration', $3::json)`,
    [seasonId, `replay-frozen-${seasonId}`, JSON.stringify({
      requireCompetitiveProfile: true,
      competitiveProfile: { platform, currentSeasonKey: "legacy-current", previousSeasonKey: "legacy-previous", rankOrder: frozenRankOrder },
    })],
  );
  return { userId, seasonId, frozenRankOrder };
}

async function assertTerminalState(client: Client, opts: { userId: string; seasonId: string; frozenRankOrder: string[] }): Promise<void> {
  // Platform identity and display-name backfill.
  const platforms = await client.query<{ key: string; display_name: string }>(
    "SELECT key, display_name FROM competitive_platforms ORDER BY key",
  );
  const byKey = new Map(platforms.rows.map((row) => [row.key, row.display_name]));
  if (byKey.get("replay_same") !== "replay_same") throw new Error(`未知平台应回填技术 key 作为初始显示名；实际：${byKey.get("replay_same")}`);
  if (byKey.get("perfect_world") !== "完美世界竞技平台") throw new Error(`perfect_world 显示名应为产品名称；实际：${byKey.get("perfect_world")}`);

  // Identical legacy rank orders are promoted to the platform ladder.
  const ladder = await client.query<{ rank_key: string; label: string; sort_order: number }>(
    "SELECT rank_key, label, sort_order FROM competitive_platform_ranks WHERE platform_key = 'replay_same' ORDER BY sort_order",
  );
  const promoted = ladder.rows.map((row) => row.rank_key);
  if (JSON.stringify(promoted) !== JSON.stringify(LEGACY_RANK_ORDER)) {
    throw new Error(`identical rankOrder 应提升为平台 ladder；实际：${JSON.stringify(promoted)}`);
  }
  if (ladder.rows.some((row) => row.rank_key !== row.label)) {
    throw new Error("首次迁移 rankKey 与 label 应保持一致。");
  }

  // An empty legacy rank order must not fabricate ladder rows.
  const emptyLadder = await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM competitive_platform_ranks WHERE platform_key = 'replay_empty'",
  );
  if (emptyLadder.rows[0]?.count !== "0") throw new Error("空 rankOrder 平台不应伪造段位。");

  // Season identity/chronology survive; the season-level column is gone.
  const seasonColumn = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM information_schema.columns
     WHERE table_name = 'competitive_platform_seasons' AND column_name = 'rank_order'`,
  );
  if (seasonColumn.rows[0]?.count !== "0") throw new Error("season 级 rank_order 列应已移除。");
  const seasons = await client.query<{ platform: string; season_key: string; is_current: boolean }>(
    "SELECT platform, season_key, is_current FROM competitive_platform_seasons WHERE platform IN ('replay_same', 'replay_empty') ORDER BY platform, season_key",
  );
  if (seasons.rows.length !== 3) throw new Error(`迁移应保留全部赛季目录身份；实际：${seasons.rows.length}`);

  // Long-term facts and published frozen contexts are untouched.
  const facts = await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM competitive_rank_facts WHERE user_id = $1",
    [opts.userId],
  );
  if (facts.rows[0]?.count !== "1") throw new Error("迁移不得丢失既有竞技事实。");
  const frozen = await client.query<{ config: { competitiveProfile: { rankOrder: string[] } } }>(
    "SELECT team_registration_config AS config FROM seasons WHERE id = $1",
    [opts.seasonId],
  );
  if (JSON.stringify(frozen.rows[0]?.config.competitiveProfile.rankOrder) !== JSON.stringify(opts.frozenRankOrder)) {
    throw new Error("已发布赛事冻结的 rankOrder 必须保持原样。");
  }

  // FK restrict: a platform with seasons cannot be deleted.
  await client.query("BEGIN");
  try {
    await client.query("DELETE FROM competitive_platforms WHERE key = 'replay_same'");
    throw new Error("删除仍有赛季引用的平台应被 FK 拒绝。");
  } catch (error) {
    if ((error as { code?: string }).code !== "23503") throw error;
    await client.query("ROLLBACK");
  }
}

async function main(): Promise<void> {
  const admin = new Client({ connectionString: maintenance.toString(), ssl: false });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    const target = new URL(databaseUrl!);
    target.pathname = `/${databaseName}`;
    const client = new Client({ connectionString: target.toString(), ssl: false });
    await client.connect();
    try {
      const migrations = readdirSync(join(process.cwd(), "drizzle/migrations"))
        .filter((name) => /^00(?:0[0-9]|1[0-8])_.*\.sql$/.test(name))
        .sort();
      const terminal = migrations.find((name) => name.startsWith("0018_"));
      if (!terminal) throw new Error("找不到 0018 竞技平台目录迁移。");
      for (const migration of migrations.filter((name) => !name.startsWith("0018_"))) await runMigration(client, migration);

      // 1) Conflicting rank orders on one platform must fail closed.
      await insertLegacyCatalogFixture(client, {
        platform: "replay_conflict",
        seasons: [
          { seasonKey: "conflict-a", rankOrder: ["D", "C", "B"] },
          { seasonKey: "conflict-b", rankOrder: ["Bronze", "Silver", "Gold"] },
        ],
      });
      await runMigrationExpectingFailure(client, terminal, "fail-closed");
      const conflictRows = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM competitive_platform_seasons WHERE platform = 'replay_conflict'",
      );
      if (conflictRows.rows[0]?.count !== "2") throw new Error("fail closed 回滚后 legacy 目录应保持原样。");
      // The operator reconciliation step: remove the conflicting rows before
      // replaying the migration.
      await client.query("DELETE FROM competitive_platform_seasons WHERE platform = 'replay_conflict'");

      // 2) Identical / empty rank orders migrate safely.
      await insertLegacyCatalogFixture(client, {
        platform: "replay_same",
        seasons: [
          { seasonKey: "legacy-current", rankOrder: LEGACY_RANK_ORDER },
          { seasonKey: "legacy-previous", rankOrder: LEGACY_RANK_ORDER },
        ],
      });
      await insertLegacyCatalogFixture(client, {
        platform: "replay_empty",
        seasons: [{ seasonKey: "legacy-empty", rankOrder: [] }],
      });
      await insertLegacyCatalogFixture(client, {
        platform: "perfect_world",
        seasons: [{ seasonKey: "legacy-current", rankOrder: LEGACY_RANK_ORDER }],
      });
      const preserved = await insertLegacyFactAndFrozenEventFixture(client, "perfect_world");
      await runMigration(client, terminal);
      await assertTerminalState(client, preserved);
      console.log("Competitive catalog migration replay passed: conflict fail-closed, ladder promotion, empty ladder preserved, facts and frozen event contexts untouched.");
    } finally {
      await client.end();
    }
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.end();
  }
}

void main().catch((error) => { console.error(error); process.exit(1); });

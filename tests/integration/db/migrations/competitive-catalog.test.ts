import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { migrationFiles, replayMigration, withScratchDatabase } from "../harness/migration-replay";
import { capturePostgresError } from "../harness/database";
import { BUILT_IN_COMPETITIVE_PLATFORMS } from "../../../../src/lib/competitive/builtins";

/**
 * Local replay for the 0018 competitive platform catalog migration and the
 * 0020 built-in catalog + stars bootstrap. Each migration replays in its own
 * scratch database seeded with the exact pre-migration state.
 *
 * 0018 verified invariants:
 * - conflicting non-empty rank orders fail closed with an operator message;
 * - identical rank orders are promoted to a platform ladder (key = label);
 * - an empty rank order yields a platform without a fabricated ladder;
 * - competitive_rank_facts and published frozen competitiveProfile contexts
 *   are preserved byte-for-byte.
 *
 * 0020 verified invariants:
 * - a clean 0019 catalog bootstraps Perfect World (Rating Pro) and 5E (Rating+)
 *   ladders with exact S-tier star ranges plus 2026S1/S2 and 2026S3/S4 seasons;
 * - pre-existing built-in platform seasons (including Perfect S23/S24 naming),
 *   foreign rank keys, divergent ladder positions and conflicting Rating labels
 *   all fail closed before any mutation;
 * - legacy rank facts keep stars NULL and published frozen contexts stay
 *   byte-for-byte identical;
 * - the star columns reject invalid ranges and negative fact stars at the
 *   database level.
 */

async function runMigrationExpectingFailure(client: Client, name: string, keyword: string): Promise<string> {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const source = readFileSync(join(process.cwd(), "drizzle/migrations", name), "utf8");
  await client.query("BEGIN");
  try {
    await client.query(source);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(keyword)) {
      throw new Error(`迁移 ${name} 应因「${keyword}」fail closed，实际错误为：${message}`);
    }
    return message;
  }
  throw new Error(`迁移 ${name} 在冲突数据上成功执行，未按 fail closed 终止。`);
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
  await withScratchDatabase("rivalhub_0018", async (client) => {
      const migrations = migrationFiles((name) => /^00(?:0[0-9]|1[0-9])_.*\.sql$/.test(name))
        .filter((name) => /^00(?:0[0-9]|1[0-8])_.*\.sql$/.test(name))
      const terminal = migrations.find((name) => name.startsWith("0018_"));
      if (!terminal) throw new Error("找不到 0018 竞技平台目录迁移。");
      for (const migration of migrations.filter((name) => !name.startsWith("0018_"))) await replayMigration(client, migration);

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
      await replayMigration(client, terminal);
      await assertTerminalState(client, preserved);
      console.log("Competitive catalog migration replay passed: conflict fail-closed, ladder promotion, empty ladder preserved, facts and frozen event contexts untouched.");
  });

  await replay0020StarsBootstrap();
}

// ── 0020 built-in catalog + stars bootstrap ─────────────────────────────────

// Expected rows are derived from the code-owned product definition so a SQL
// drift in 0020 makes this replay fail instead of both copies silently
// agreeing on the same mistake.
type ExpectedRankRow = { rank_key: string; label: string; sort_order: number; star_min: number | null; star_max: number | null };

function expectedRankRows(platformKey: "perfect_world" | "fivee"): ExpectedRankRow[] {
  return BUILT_IN_COMPETITIVE_PLATFORMS[platformKey].ranks.map((rank) => ({
    rank_key: rank.rankKey, label: rank.label, sort_order: rank.sortOrder, star_min: rank.starMin, star_max: rank.starMax,
  }));
}

async function assertLadder(client: Client, platformKey: "perfect_world" | "fivee"): Promise<void> {
  const ladder = await client.query<ExpectedRankRow>(
    "SELECT rank_key, label, sort_order, star_min, star_max FROM competitive_platform_ranks WHERE platform_key = $1 ORDER BY sort_order",
    [platformKey],
  );
  const expected = expectedRankRows(platformKey);
  if (JSON.stringify(ladder.rows) !== JSON.stringify(expected)) {
    throw new Error(`${platformKey} ladder 与 2.0 产品定义不一致：${JSON.stringify(ladder.rows)}`);
  }
}

async function assert0020TerminalState(client: Client, opts: { userId: string; seasonId: string; frozenConfig: unknown }): Promise<void> {
  const platforms = await client.query<{ key: string; display_name: string; rating_label: string }>(
    "SELECT key, display_name, rating_label FROM competitive_platforms ORDER BY key",
  );
  const byKey = new Map(platforms.rows.map((row) => [row.key, row]));
  for (const definition of Object.values(BUILT_IN_COMPETITIVE_PLATFORMS)) {
    const row = byKey.get(definition.key);
    if (row?.display_name !== definition.displayName || row?.rating_label !== definition.ratingLabel) {
      throw new Error(`${definition.key} 应为「${definition.displayName} / ${definition.ratingLabel}」；实际：${JSON.stringify(row)}`);
    }
  }
  if (platforms.rows.length !== Object.keys(BUILT_IN_COMPETITIVE_PLATFORMS).length) {
    throw new Error(`0020 只应出现内置平台；实际：${platforms.rows.map((row) => row.key).join(",")}`);
  }

  await assertLadder(client, "perfect_world");
  await assertLadder(client, "fivee");

  const seasons = await client.query<{ platform: string; season_key: string; label: string; active: boolean; is_current: boolean; sort_order: number }>(
    "SELECT platform, season_key, label, active, is_current, sort_order FROM competitive_platform_seasons ORDER BY platform, sort_order",
  );
  const expectedSeasons = [
    { platform: "fivee", season_key: "2026s3", label: "2026S3", active: true, is_current: false, sort_order: 202603 },
    { platform: "fivee", season_key: "2026s4", label: "2026S4", active: true, is_current: true, sort_order: 202604 },
    { platform: "perfect_world", season_key: "2026s1", label: "2026S1", active: true, is_current: false, sort_order: 202601 },
    { platform: "perfect_world", season_key: "2026s2", label: "2026S2", active: true, is_current: true, sort_order: 202602 },
  ];
  if (JSON.stringify(seasons.rows) !== JSON.stringify(expectedSeasons)) {
    throw new Error(`0020 赛季目录与产品定义不一致：${JSON.stringify(seasons.rows)}`);
  }
  const currentCounts = await client.query<{ platform: string; count: string }>(
    "SELECT platform, count(*)::text AS count FROM competitive_platform_seasons WHERE is_current GROUP BY platform",
  );
  if (currentCounts.rows.some((row) => row.count !== "1")) throw new Error("每个平台必须恰好一个当前赛季。");

  // Legacy facts keep stars NULL; nothing guesses a default value.
  const factRows = await client.query<{ stars: number | null; rank: string; rating: string }>(
    "SELECT stars, rank, rating::text AS rating FROM competitive_rank_facts WHERE user_id = $1 ORDER BY rank",
    [opts.userId],
  );
  if (factRows.rows.length !== 2) throw new Error(`legacy 竞技事实应原样保留 2 条；实际：${factRows.rows.length}`);
  if (factRows.rows.some((row) => row.stars !== null)) throw new Error("legacy 事实的 stars 必须保持 NULL，不得伪造。");

  const frozen = await client.query<{ config: unknown }>(
    "SELECT team_registration_config AS config FROM seasons WHERE id = $1",
    [opts.seasonId],
  );
  if (JSON.stringify(frozen.rows[0]?.config) !== JSON.stringify(opts.frozenConfig)) {
    throw new Error("已发布赛事冻结的 competitiveProfile 上下文必须保持 byte-for-byte 不变。");
  }

  // Star metadata is enforced by the database, not only by application code.
  // Savepoints require an explicit transaction block on the replay client.
  await client.query("BEGIN");
  try {
    const badRange = await capturePostgresError(client, () => client.query(
      "INSERT INTO competitive_platform_ranks (platform_key, rank_key, label, sort_order, star_min, star_max) VALUES ('fivee', 'bad-range', 'bad-range', 99, NULL, 5)",
      [],
    ));
    expect(badRange).toMatchObject({ code: "23514" });
    const reversedRange = await capturePostgresError(client, () => client.query(
      "INSERT INTO competitive_platform_ranks (platform_key, rank_key, label, sort_order, star_min, star_max) VALUES ('fivee', 'bad-order', 'bad-order', 99, 24, 10)",
      [],
    ));
    expect(reversedRange).toMatchObject({ code: "23514" });
    const negativeStars = await capturePostgresError(client, () => client.query(
      "INSERT INTO competitive_rank_facts (user_id, platform, kind, rank, rating, stars) VALUES ($1, 'fivee', 'historical_peak', 'S', 1000, -1)",
      [opts.userId],
    ));
    expect(negativeStars).toMatchObject({ code: "23514" });
  } finally {
    await client.query("ROLLBACK");
  }
}

async function replay0020StarsBootstrap(): Promise<void> {
  const terminal = "0020_competitive_catalog_stars_bootstrap.sql";
  await withScratchDatabase("rivalhub_0020", async (client) => {
    const migrations = migrationFiles((name) => /^00(?:0[0-9]|1[0-9]|20)_.*\.sql$/.test(name))
      .filter((name) => !name.startsWith("0020_"));
    for (const migration of migrations) await replayMigration(client, migration);

    // Fail-closed scenarios: each conflict is seeded on the 0019 state, must
    // abort 0020 before any mutation, and is cleaned up before the next case.
    const perfect = BUILT_IN_COMPETITIVE_PLATFORMS.perfect_world;
    const fivee = BUILT_IN_COMPETITIVE_PLATFORMS.fivee;
    const conflicts: Array<{ label: string; seed: string[]; cleanup: string[]; keyword: string }> = [
      {
        label: "存在未知第三平台 faceit",
        seed: [
          "INSERT INTO competitive_platforms (key, display_name, rating_label) VALUES ('faceit', 'FACEIT', 'Elo')",
        ],
        cleanup: ["DELETE FROM competitive_platforms WHERE key = 'faceit'"],
        keyword: "未知竞技平台",
      },
      {
        label: "perfect_world 已存在 S24 赛季",
        seed: [
          `INSERT INTO competitive_platforms (key, display_name, rating_label) VALUES ('perfect_world', '${perfect.displayName}', '${perfect.ratingLabel}')`,
          "INSERT INTO competitive_platform_seasons (platform, season_key, label, active, sort_order, is_current) VALUES ('perfect_world', 'S24', 'S24', true, 0, true)",
        ],
        cleanup: [
          "DELETE FROM competitive_platform_seasons WHERE platform = 'perfect_world'",
          "DELETE FROM competitive_platforms WHERE key = 'perfect_world'",
        ],
        keyword: "reconcile",
      },
      {
        label: "fivee 已存在赛季目录",
        seed: [
          `INSERT INTO competitive_platforms (key, display_name, rating_label) VALUES ('fivee', '${fivee.displayName}', '${fivee.ratingLabel}')`,
          "INSERT INTO competitive_platform_seasons (platform, season_key, label, active, sort_order, is_current) VALUES ('fivee', '2026s9', '2026S9', true, 0, true)",
        ],
        cleanup: [
          "DELETE FROM competitive_platform_seasons WHERE platform = 'fivee'",
          "DELETE FROM competitive_platforms WHERE key = 'fivee'",
        ],
        keyword: "reconcile",
      },
      {
        label: "perfect_world 存在非 2.0 ladder 的 rankKey",
        seed: [
          `INSERT INTO competitive_platforms (key, display_name, rating_label) VALUES ('perfect_world', '${perfect.displayName}', '${perfect.ratingLabel}')`,
          "INSERT INTO competitive_platform_ranks (platform_key, rank_key, label, sort_order) VALUES ('perfect_world', 'Legend', 'Legend', 0)",
        ],
        cleanup: [
          "DELETE FROM competitive_platform_ranks WHERE platform_key = 'perfect_world'",
          "DELETE FROM competitive_platforms WHERE key = 'perfect_world'",
        ],
        keyword: "reconcile",
      },
      {
        label: "已有 rankKey 的 sortOrder 与产品 ladder 冲突",
        seed: [
          `INSERT INTO competitive_platforms (key, display_name, rating_label) VALUES ('perfect_world', '${perfect.displayName}', '${perfect.ratingLabel}')`,
          "INSERT INTO competitive_platform_ranks (platform_key, rank_key, label, sort_order) VALUES ('perfect_world', 'C', 'C', 0), ('perfect_world', 'D', 'D', 1)",
        ],
        cleanup: [
          "DELETE FROM competitive_platform_ranks WHERE platform_key = 'perfect_world'",
          "DELETE FROM competitive_platforms WHERE key = 'perfect_world'",
        ],
        keyword: "reconcile",
      },
      {
        label: "perfect_world 的 canonical Rating 与产品定义冲突",
        seed: [
          "INSERT INTO competitive_platforms (key, display_name, rating_label) VALUES ('perfect_world', '完美世界竞技平台', 'Elo')",
        ],
        cleanup: ["DELETE FROM competitive_platforms WHERE key = 'perfect_world'"],
        keyword: "reconcile",
      },
    ];
    for (const conflict of conflicts) {
      for (const statement of conflict.seed) await client.query(statement);
      try {
        await runMigrationExpectingFailure(client, terminal, conflict.keyword);
      } catch (error) {
        throw new Error(`场景「${conflict.label}」失败：${error instanceof Error ? error.message : String(error)}`);
      }
      for (const statement of conflict.cleanup) await client.query(statement);
      const remaining = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM competitive_platforms");
      if (remaining.rows[0]?.count !== "0") throw new Error(`场景「${conflict.label}」清理后目录应为空。`);
    }

    // Clean 0019 state: legacy facts and a published frozen event must survive
    // the bootstrap byte-for-byte with stars still NULL.
    const userId = randomUUID();
    const seasonId = randomUUID();
    await client.query("INSERT INTO users (id, email) VALUES ($1, $2)", [userId, `stars-replay-${userId}@local.test`]);
    await client.query(
      `INSERT INTO competitive_rank_facts (user_id, platform, kind, platform_season_key, rank, rating)
       VALUES ($1, 'perfect_world', 'historical_peak', NULL, '黄金S', 2100),
              ($1, 'perfect_world', 'season_peak', 'legacy-season', 'A++', 1900)`,
      [userId],
    );
    const frozenConfig = {
      requireCompetitiveProfile: true,
      competitiveProfile: {
        platform: "perfect_world",
        currentSeasonKey: "2026s2",
        previousSeasonKey: "2026s1",
        rankOrder: BUILT_IN_COMPETITIVE_PLATFORMS.perfect_world.ranks.map((rank) => rank.rankKey),
      },
    };
    await client.query(
      `INSERT INTO seasons (id, slug, name, kind, status, team_registration_config) VALUES ($1, $2, 'Stars Replay Published Major', 'Major', 'registration', $3::json)`,
      [seasonId, `stars-frozen-${seasonId}`, JSON.stringify(frozenConfig)],
    );

    await replayMigration(client, terminal);
    await assert0020TerminalState(client, { userId, seasonId, frozenConfig });
    console.log("0020 stars bootstrap replay passed: built-in Perfect/5E catalogs derived from the canonical definition with exact star ranges and 2026 seasons, six fail-closed conflict scenarios (including unknown third platform), legacy facts and frozen events untouched, DB CHECK enforcement verified.");
  });
}

describe("competitive catalog migration replay", () => {
  it("fails closed on conflicts and preserves historical facts", async () => {
    await main();
  });
});

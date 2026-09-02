import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { assertPlatformRanksMutable, loadReferencedPlatformRankKeys } from "../../../src/lib/competitive/catalog";
import { capturePostgresError, createLocalPool } from "./harness/database";

async function main(): Promise<void> {
  const pool = createLocalPool({ max: 1 });
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
    expect([...referenced].sort()).toEqual(["C+", "C++", "青铜S"].sort());
    await expect(assertPlatformRanksMutable(executor, platform, ["C++"])).rejects.toThrow(
      /已被竞技资料或已开放报名赛事冻结的段位顺序引用/,
    );
    await expect(assertPlatformRanksMutable(executor, platform, ["unreferenced"])).resolves.not.toThrow();

    // The catalog delete guard must execute against json columns as jsonb when
    // checking a frozen evidencePolicy.recentSeasonKeys array.
    await client.query(
      "UPDATE seasons SET team_registration_config = $2::json WHERE id = $1",
      [seasonId, JSON.stringify({ competitiveProfile: { platform, currentSeasonKey: "legacy-current", previousSeasonKey: "legacy-previous", rankOrder: [], evidencePolicy: { historicalWeight: 50, referenceSeasonKey: "older", referenceSeasonWeight: 20, recentSeasonKeys: ["recent-only"], recentSeasonWeight: 30 } } })],
    );
    const recentPolicyReference = await client.query(
      `SELECT id FROM seasons
       WHERE team_registration_config->'competitiveProfile'->>'platform' = $1
         AND (team_registration_config->'competitiveProfile'->'evidencePolicy'->'recentSeasonKeys')::jsonb ? $2`,
      [platform, "recent-only"],
    );
    expect(recentPolicyReference.rowCount).toBe(1);

    // Star metadata shape is enforced by the database: no starMax without a
    // starMin, no descending range, no negative fact stars.
    const malformedRankShape = await capturePostgresError(client, () => client.query(
      "INSERT INTO competitive_platform_ranks (platform_key, rank_key, label, sort_order, star_min, star_max) VALUES ($1, 'bad-shape', 'bad-shape', 99, NULL, 5)",
      [platform],
    ));
    expect(malformedRankShape).toMatchObject({ code: "23514" });
    const descendingRankRange = await capturePostgresError(client, () => client.query(
      "INSERT INTO competitive_platform_ranks (platform_key, rank_key, label, sort_order, star_min, star_max) VALUES ($1, 'bad-order', 'bad-order', 99, 24, 10)",
      [platform],
    ));
    expect(descendingRankRange).toMatchObject({ code: "23514" });
    const negativeFactStars = await capturePostgresError(client, () => client.query(
      "INSERT INTO competitive_rank_facts (user_id, platform, kind, rank, rating, stars) VALUES ($1, $2, 'historical_peak', 'C+', 1234, -1)",
      [userId, platform],
    ));
    expect(negativeFactStars).toMatchObject({ code: "23514" });

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

describe("competitive catalog PostgreSQL invariants", () => {
  it("preserves frozen references and database CHECK constraints", async () => {
    await main();
  });
});

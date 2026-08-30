import type { Pool, PoolClient } from "pg";

/**
 * Seed helpers for the platform-owned competitive catalog in local
 * integration fixtures. Fixtures must express the terminal model:
 * competitive_platforms + competitive_platform_ranks + competitive_platform_seasons.
 */

export interface FixtureSeasonSeed {
  seasonKey: string;
  label: string;
  sortOrder: number;
  isCurrent: boolean;
  active?: boolean;
}

export async function seedCompetitivePlatformCatalog(
  client: Pool | PoolClient,
  platform: string,
  seasons: FixtureSeasonSeed[],
  rankOrder: readonly string[],
): Promise<void> {
  await client.query(
    "INSERT INTO competitive_platforms (key, display_name) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING",
    [platform, platform],
  );
  if (rankOrder.length > 0) {
    await client.query(
      `INSERT INTO competitive_platform_ranks (platform_key, rank_key, label, sort_order)
       SELECT $1, value, value, ordinality - 1 FROM unnest($2::text[]) WITH ORDINALITY AS t(value, ordinality)
       ON CONFLICT (platform_key, rank_key) DO NOTHING`,
      [platform, [...rankOrder]],
    );
  }
  for (const season of seasons) {
    await client.query(
      `INSERT INTO competitive_platform_seasons (platform, season_key, label, active, sort_order, is_current)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (platform, season_key) DO UPDATE
       SET label = EXCLUDED.label, active = EXCLUDED.active, sort_order = EXCLUDED.sort_order, is_current = EXCLUDED.is_current, updated_at = now()`,
      [platform, season.seasonKey, season.label, season.active ?? true, season.sortOrder, season.isCurrent],
    );
  }
}

export async function deleteCompetitivePlatformCatalog(client: Pool | PoolClient, platform: string, seasonKeys?: readonly string[]): Promise<void> {
  if (seasonKeys) {
    await client.query("DELETE FROM competitive_platform_seasons WHERE platform = $1 AND season_key = ANY($2::text[])", [platform, [...seasonKeys]]);
  } else {
    await client.query("DELETE FROM competitive_platform_seasons WHERE platform = $1", [platform]);
    await client.query("DELETE FROM competitive_platform_ranks WHERE platform_key = $1", [platform]);
    await client.query("DELETE FROM competitive_platforms WHERE key = $1", [platform]);
  }
}

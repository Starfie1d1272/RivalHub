import { and, asc, eq } from "drizzle-orm";
import type { db as dbClient } from "@/db/client";
import { competitivePlatformRanks, competitivePlatformSeasons, competitivePlatforms } from "@/db/schema";
import type { CompetitiveProfileConfig } from "@/types/season";

/**
 * Single read-model owner for the competitive platform catalog: platforms,
 * their platform-owned rank ladder and their season chronology. Server
 * Components, publish-time freezing and qualification resolution all consume
 * these loaders so the ladder has exactly one runtime source of truth.
 */

export type DatabaseExecutor = typeof dbClient | Parameters<Parameters<typeof dbClient.transaction>[0]>[0];

export interface CatalogSeason {
  id: string;
  seasonKey: string;
  label: string;
  /** Chronology position; higher = later season. */
  sortOrder: number;
  active: boolean;
  isCurrent: boolean;
}

export interface CatalogRank {
  id: string;
  rankKey: string;
  label: string;
  /** Lowest → highest position on the ladder. */
  sortOrder: number;
}

export interface CompetitivePlatformCatalogEntry {
  key: string;
  displayName: string;
  ranks: CatalogRank[];
  seasons: CatalogSeason[];
}

export async function loadCompetitivePlatformCatalog(
  executor: DatabaseExecutor,
): Promise<CompetitivePlatformCatalogEntry[]> {
  const [platforms, ranks, seasons] = await Promise.all([
    executor.select().from(competitivePlatforms).orderBy(asc(competitivePlatforms.key)),
    executor.select().from(competitivePlatformRanks).orderBy(asc(competitivePlatformRanks.platformKey), asc(competitivePlatformRanks.sortOrder)),
    executor.select().from(competitivePlatformSeasons).orderBy(asc(competitivePlatformSeasons.platform), asc(competitivePlatformSeasons.sortOrder)),
  ]);
  return platforms.map((platform) => ({
    key: platform.key,
    displayName: platform.displayName,
    ranks: ranks
      .filter((rank) => rank.platformKey === platform.key)
      .map((rank) => ({ id: rank.id, rankKey: rank.rankKey, label: rank.label, sortOrder: rank.sortOrder })),
    seasons: seasons
      .filter((season) => season.platform === platform.key)
      .map((season) => ({ id: season.id, seasonKey: season.seasonKey, label: season.label, sortOrder: season.sortOrder, active: season.active, isCurrent: season.isCurrent })),
  }));
}

export interface ResolvedCatalogContext {
  platform: string;
  currentSeasonKey: string;
  previousSeasonKey: string;
  /** Lowest → highest stable rank keys of the platform ladder. */
  rankOrder: string[];
}

export interface CatalogResolution {
  currentSeasonKey: string;
  previousSeasonKey: string;
  /** Lowest → highest stable rank keys of the platform ladder. */
  rankOrder: string[];
}

/**
 * Resolve the effective current/previous season and platform ladder for a
 * platform. Returns null when the catalog is incomplete — callers must fail
 * closed instead of falling back to hardcoded ranks.
 *
 * `previous` is derived from chronology (the latest active season before the
 * current one); it never has a second mutable flag.
 */
export function resolvePlatformCatalog(
  entry: Pick<CompetitivePlatformCatalogEntry, "ranks" | "seasons"> | undefined,
): CatalogResolution | null {
  if (!entry) return null;
  const current = entry.seasons.find((season) => season.isCurrent && season.active);
  if (!current) return null;
  const previous = entry.seasons
    .filter((season) => season.active && season.sortOrder < current.sortOrder)
    .sort((a, b) => b.sortOrder - a.sortOrder)[0];
  if (!previous) return null;
  const rankOrder = [...entry.ranks].sort((a, b) => a.sortOrder - b.sortOrder).map((rank) => rank.rankKey);
  if (rankOrder.length === 0) return null;
  return { currentSeasonKey: current.seasonKey, previousSeasonKey: previous.seasonKey, rankOrder };
}

/**
 * Publish-time freeze source: current season, previous season and the current
 * rank ladder of one platform, resolved inside the publish transaction.
 */
export async function resolveLiveCompetitiveContext(
  executor: DatabaseExecutor,
  platform: string,
): Promise<ResolvedCatalogContext | null> {
  const [platformRow] = await executor.select().from(competitivePlatforms).where(eq(competitivePlatforms.key, platform)).limit(1);
  if (!platformRow) return null;
  const [seasons, ranks] = await Promise.all([
    executor.select().from(competitivePlatformSeasons).where(and(eq(competitivePlatformSeasons.platform, platform), eq(competitivePlatformSeasons.active, true))).orderBy(asc(competitivePlatformSeasons.sortOrder)),
    executor.select().from(competitivePlatformRanks).where(eq(competitivePlatformRanks.platformKey, platform)).orderBy(asc(competitivePlatformRanks.sortOrder)),
  ]);
  const resolved = resolvePlatformCatalog({
    ranks: ranks.map((rank) => ({ id: rank.id, rankKey: rank.rankKey, label: rank.label, sortOrder: rank.sortOrder })),
    seasons: seasons.map((season) => ({ id: season.id, seasonKey: season.seasonKey, label: season.label, sortOrder: season.sortOrder, active: season.active, isCurrent: season.isCurrent })),
  });
  return resolved ? { platform, ...resolved } : null;
}

/** Adapt a resolved catalog context to the frozen event profile shape. */
export function toCompetitiveProfileConfig(context: ResolvedCatalogContext): CompetitiveProfileConfig {
  return {
    platform: context.platform,
    currentSeasonKey: context.currentSeasonKey,
    previousSeasonKey: context.previousSeasonKey,
    rankOrder: context.rankOrder,
  };
}

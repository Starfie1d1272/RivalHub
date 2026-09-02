import { and, asc, eq, sql } from "drizzle-orm";
import type { db as dbClient } from "@/db/client";
import { competitivePlatformRanks, competitivePlatformSeasons, competitivePlatforms, competitiveRankFacts } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import type { CompetitiveProfileConfig } from "@/types/season";
import { compareCompetitivePlatformPriority } from "./builtins";

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
  /** Inclusive lower bound for stars; null/null means this rank has no stars. */
  starMin: number | null;
  /** Inclusive upper bound; null with starMin means open-ended. */
  starMax: number | null;
}

export interface CompetitivePlatformCatalogEntry {
  key: string;
  displayName: string;
  /** The platform's canonical performance-rating label (never a ladder/MMR score). */
  ratingLabel: string;
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
  return platforms.sort((left, right) => compareCompetitivePlatformPriority(left.key, right.key)).map((platform) => ({
    key: platform.key,
    displayName: platform.displayName,
    ratingLabel: platform.ratingLabel,
    ranks: ranks
      .filter((rank) => rank.platformKey === platform.key)
      .map((rank) => ({ id: rank.id, rankKey: rank.rankKey, label: rank.label, sortOrder: rank.sortOrder, starMin: rank.starMin, starMax: rank.starMax })),
    seasons: seasons
      .filter((season) => season.platform === platform.key)
      .map((season) => ({ id: season.id, seasonKey: season.seasonKey, label: season.label, sortOrder: season.sortOrder, active: season.active, isCurrent: season.isCurrent })),
  }));
}

export interface ResolvedCatalogContext {
  platform: string;
  currentSeasonKey: string;
  previousSeasonKey: string;
  /** The active season immediately before `previousSeasonKey`, if catalogued. */
  priorSeasonKey?: string | null;
  /** Lowest → highest stable rank keys of the platform ladder. */
  rankOrder: string[];
}

export interface CatalogResolution {
  currentSeasonKey: string;
  previousSeasonKey: string;
  /** Lowest → highest stable rank keys of the platform ladder. */
  rankOrder: string[];
}

export interface CatalogSeasonRoles {
  current: CatalogSeason | null;
  /** Latest active season before current. Archived seasons are historical only. */
  previous: CatalogSeason | null;
}

/** Uses slots below every existing value, never magic -1/-2 positions. */
export function temporarySortOrders(existing: readonly number[]): readonly [number, number] {
  const minimum = Math.min(...existing);
  if (!Number.isSafeInteger(minimum) || minimum <= -2_147_483_646) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "目录排序值已超出可安全交换的范围，请联系维护者修复目录。");
  }
  return [minimum - 2, minimum - 1];
}

/**
 * Canonical chronology owner for all catalog callers. `previous` deliberately
 * considers only active seasons, matching the publish-time qualification
 * semantics; inactive seasons remain visible as historical catalog entries.
 */
export function resolveCatalogSeasonRoles(
  entry: Pick<CompetitivePlatformCatalogEntry, "seasons"> | undefined,
): CatalogSeasonRoles {
  const current = entry?.seasons.find((season) => season.isCurrent && season.active) ?? null;
  if (!current) return { current: null, previous: null };
  const previous = entry!.seasons
    .filter((season) => season.active && season.sortOrder < current.sortOrder)
    .sort((a, b) => b.sortOrder - a.sortOrder)[0] ?? null;
  return { current, previous };
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
  const { current, previous } = resolveCatalogSeasonRoles(entry);
  if (!current) return null;
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
    ranks: ranks.map((rank) => ({ id: rank.id, rankKey: rank.rankKey, label: rank.label, sortOrder: rank.sortOrder, starMin: rank.starMin, starMax: rank.starMax })),
    seasons: seasons.map((season) => ({ id: season.id, seasonKey: season.seasonKey, label: season.label, sortOrder: season.sortOrder, active: season.active, isCurrent: season.isCurrent })),
  });
  if (!resolved) return null;
  const prior = seasons
    .filter((season) => season.active && season.sortOrder < (seasons.find((season) => season.seasonKey === resolved.previousSeasonKey)?.sortOrder ?? Number.NEGATIVE_INFINITY))
    .sort((a, b) => b.sortOrder - a.sortOrder)[0] ?? null;
  return { platform, ...resolved, priorSeasonKey: prior?.seasonKey ?? null };
}

/**
 * Referenced ladder identities are immutable until a versioned ladder exists.
 * This executes against PostgreSQL (including the JSON frozen snapshot) and
 * is shared by catalog mutations and Local-DB coverage.
 */
export async function loadReferencedPlatformRankKeys(
  executor: DatabaseExecutor,
  platform: string,
): Promise<Set<string>> {
  const facts = await executor.select({ rank: competitiveRankFacts.rank })
    .from(competitiveRankFacts)
    .where(eq(competitiveRankFacts.platform, platform));
  const frozen = await executor.execute<{ rank: string }>(sql`
    SELECT DISTINCT json_array_elements_text(team_registration_config->'competitiveProfile'->'rankOrder') AS rank
    FROM seasons
    WHERE team_registration_config->'competitiveProfile'->>'platform' = ${platform}
  `);
  return new Set([...facts.map((row) => row.rank).filter((rank): rank is string => rank !== null), ...frozen.rows.map((row) => row.rank)]);
}

/** Fail closed before a ladder mutation would rewrite referenced semantics. */
export async function assertPlatformRanksMutable(
  executor: DatabaseExecutor,
  platform: string,
  rankKeys: readonly string[],
): Promise<void> {
  const referenced = await loadReferencedPlatformRankKeys(executor, platform);
  const blocked = rankKeys.find((key) => referenced.has(key));
  if (blocked) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `段位 ${blocked} 已被竞技资料或已开放报名赛事冻结的段位顺序引用，不能修改。`);
  }
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

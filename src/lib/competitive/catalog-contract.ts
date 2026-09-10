/** Client-safe catalog read model and pure chronology projection. */

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

export interface CatalogSeasonRoles {
  current: CatalogSeason | null;
  /** Latest active season before current. Archived seasons are historical only. */
  previous: CatalogSeason | null;
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

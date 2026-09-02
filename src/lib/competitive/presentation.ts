import { CS2_POSITION_LABELS } from "@/lib/config/cs2-positions";
import type { CompetitivePlatformCatalogEntry } from "./catalog";

export interface CompetitiveProfileFactForPresentation {
  id: string;
  platform: string;
  kind: "historical_peak" | "season_peak";
  platformSeasonKey: string | null;
  status?: "ranked" | "unranked";
  rank: string | null;
  rating: string | number | null;
  stars: number | null;
  achievedSeasonKey?: string | null;
}

export interface PublicCompetitiveProfileFact {
  label: string;
  rankLabel: string;
  stars: number | null;
  ratingLabel: string | null;
  rating: string | null;
}

export interface PublicCompetitiveProfilePlatform {
  displayName: string;
  facts: PublicCompetitiveProfileFact[];
}

/** Public presentation is catalog-backed: no persisted platform, season or rank key may leak into the player page. */
export function presentPublicCompetitiveProfile(
  catalog: readonly CompetitivePlatformCatalogEntry[],
  facts: readonly CompetitiveProfileFactForPresentation[],
): PublicCompetitiveProfilePlatform[] {
  return catalog.flatMap((platform) => {
    const ranks = new Map(platform.ranks.map((rank) => [rank.rankKey, rank]));
    const seasons = new Map(platform.seasons.map((season) => [season.seasonKey, season]));
    const visible = facts
      .filter((fact) => fact.platform === platform.key)
      .flatMap((fact): Array<PublicCompetitiveProfileFact & { order: number }> => {
        if (fact.status === "unranked") {
          const season = fact.platformSeasonKey ? seasons.get(fact.platformSeasonKey) : undefined;
          if (!season) return [];
          return [{ label: season.label, rankLabel: "未定级", stars: null, ratingLabel: fact.rating === null ? null : platform.ratingLabel, rating: fact.rating === null ? null : String(fact.rating), order: season.sortOrder }];
        }
        const rank = fact.rank ? ranks.get(fact.rank) : undefined;
        if (!rank) return [];
        if (fact.kind === "historical_peak") {
          const achieved = fact.achievedSeasonKey ? seasons.get(fact.achievedSeasonKey) : undefined;
          return [{ label: achieved ? `历史最高 · ${achieved.label}` : "历史最高", rankLabel: rank.label, stars: rank.starMin === null ? null : fact.stars, ratingLabel: platform.ratingLabel, rating: String(fact.rating), order: Number.POSITIVE_INFINITY }];
        }
        const season = fact.platformSeasonKey ? seasons.get(fact.platformSeasonKey) : undefined;
        if (!season) return [];
        return [{ label: `${season.label} · 最高`, rankLabel: rank.label, stars: rank.starMin === null ? null : fact.stars, ratingLabel: platform.ratingLabel, rating: String(fact.rating), order: season.sortOrder }];
      })
      .sort((a, b) => b.order - a.order)
      .map((fact) => ({
        label: fact.label,
        rankLabel: fact.rankLabel,
        stars: fact.stars,
        ratingLabel: fact.ratingLabel,
        rating: fact.rating,
      }));
    return visible.length > 0 ? [{ displayName: platform.displayName, facts: visible }] : [];
  });
}

/** Select the compact public view without creating a second presentation format. */
export function presentPublicCompetitiveSummary(
  catalog: readonly CompetitivePlatformCatalogEntry[],
  facts: readonly CompetitiveProfileFactForPresentation[],
): PublicCompetitiveProfilePlatform[] {
  const selectedFacts = catalog.flatMap((platform) => {
    const platformFacts = facts.filter((fact) => fact.platform === platform.key);
    const historical = platformFacts.find((fact) => fact.kind === "historical_peak");
    const seasonFacts = platformFacts.filter((fact) => fact.kind === "season_peak");
    const seasons = new Map(platform.seasons.map((season) => [season.seasonKey, season]));
    const currentSeason = platform.seasons.find((season) => season.active && season.isCurrent);
    const currentFact = currentSeason
      ? seasonFacts.find((fact) => fact.platformSeasonKey === currentSeason.seasonKey)
      : undefined;
    const recentFact = currentFact
      ? undefined
      : [...seasonFacts]
        .filter((fact) => fact.platformSeasonKey !== null && seasons.has(fact.platformSeasonKey))
        .sort((left, right) => (seasons.get(right.platformSeasonKey!)?.sortOrder ?? Number.NEGATIVE_INFINITY) - (seasons.get(left.platformSeasonKey!)?.sortOrder ?? Number.NEGATIVE_INFINITY))[0];
    return [historical, currentFact ?? recentFact].filter((fact): fact is CompetitiveProfileFactForPresentation => Boolean(fact));
  });

  return presentPublicCompetitiveProfile(catalog, selectedFacts);
}

/** Long-lived roles use the shared CS2 taxonomy, never a registration snapshot label. */
export function presentCompetitiveRole(role: string): string | null {
  return CS2_POSITION_LABELS[role as keyof typeof CS2_POSITION_LABELS]?.full ?? null;
}

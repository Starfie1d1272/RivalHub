import { CS2_POSITION_LABELS } from "@/lib/config/cs2-positions";
import type { CompetitivePlatformCatalogEntry } from "./catalog";

export interface CompetitiveProfileFactForPresentation {
  id: string;
  platform: string;
  kind: "historical_peak" | "season_peak";
  platformSeasonKey: string | null;
  rank: string;
  rating: string | number;
  stars: number | null;
}

export interface PublicCompetitiveProfileFact {
  label: string;
  rankLabel: string;
  stars: number | null;
  ratingLabel: string;
  rating: string;
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
        const rank = ranks.get(fact.rank);
        if (!rank) return [];
        if (fact.kind === "historical_peak") {
          return [{ label: "历史最高", rankLabel: rank.label, stars: rank.starMin === null ? null : fact.stars, ratingLabel: platform.ratingLabel, rating: String(fact.rating), order: Number.POSITIVE_INFINITY }];
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

/** Long-lived roles use the shared CS2 taxonomy, never a registration snapshot label. */
export function presentCompetitiveRole(role: string): string | null {
  return CS2_POSITION_LABELS[role as keyof typeof CS2_POSITION_LABELS]?.full ?? null;
}

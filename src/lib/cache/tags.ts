/** Semantic cache tags shared by public read models and their mutation owners. */
export const PUBLIC_SEASON_CATALOG_TAG = "public-season-catalog";

export function publicSeasonTag(slug: string): string {
  return `public-season:${slug}`;
}

export function seasonParticipantsTag(seasonId: string): string {
  return `season-participants:${seasonId}`;
}

export function seasonMatchesTag(seasonId: string): string {
  return `season-matches:${seasonId}`;
}

export function seasonStandingsTag(seasonId: string): string {
  return `season-standings:${seasonId}`;
}

export function publicPlayerTag(userId: string): string {
  return `public-player:${userId}`;
}

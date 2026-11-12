/** Semantic cache tags shared by public read models and their mutation owners. */
export const PUBLIC_COMPETITIVE_CATALOG_TAG = "public-competitive-catalog";
export const PUBLIC_SEASON_CATALOG_TAG = "public-season-catalog";
export const PUBLIC_ANNOUNCEMENTS_TAG = "public-announcements";
export const PUBLIC_HOME_TAG = "public-home";
/** Platform-wide statistics, including career and benchmark reads. */
export const PUBLIC_STATS_TAG = "public-stats:v1";
export const PUBLIC_STATS_PLAYER_NAMES_TAG = "public-stats:player-names";
export const ALL_EVENT_STATS_TAG = "public-stats:all-events";
export function eventStatsTag(seasonId: string) {
  return `public-stats:event:${seasonId}`;
}

export function matchStatsTag(matchId: string) {
  return `public-stats:match:${matchId}`;
}

export function publicAnnouncementsSeasonTag(seasonId: string): string {
  return `${PUBLIC_ANNOUNCEMENTS_TAG}:season:${seasonId}`;
}

export function publicSeasonInfoTag(seasonId: string): string {
  return `public-season-info:${seasonId}`;
}

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

export function publicBetTag(seasonId: string): string {
  return `public-bet:${seasonId}`;
}

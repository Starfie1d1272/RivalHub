/** One canonical reservation set for season create/update/publish and release collision checks. */
export const PLATFORM_ROUTE_SEGMENTS = ["admin", "announcements", "api", "auth", "forgot-password", "integrations", "invite", "login", "my", "players", "privacy", "reset-password", "rules", "seasons", "settings", "stats", "team-invites", "teams"] as const;
export function isReservedSeasonSlug(slug: string): boolean {
  return (PLATFORM_ROUTE_SEGMENTS as readonly string[]).includes(slug);
}

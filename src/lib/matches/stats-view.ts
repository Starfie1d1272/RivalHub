import { safeStatsReturn } from "@/lib/stats/return-context";
import { safeBetReturn } from "@/lib/bet/list-query";

export type MatchStatsSide = "overall" | "ct" | "t";
export type MatchStatsView = "compact" | "detailed";
export type MatchStatsQuery = Record<string, string | string[] | undefined>;
export interface MatchStatsScope {
  mapId: string | null;
  side: MatchStatsSide;
  view: MatchStatsView;
  playerId: string | null;
}

/** Validate against this match's identities, not the subset with advanced data. */
export function parseMatchStatsScope(query: MatchStatsQuery, maps: readonly { id: string }[], players: readonly { userId: string }[], preferredPlayerId?: string | null): MatchStatsScope {
  const playerIds = new Set(players.map(player => player.userId));
  return {
    mapId: maps.find(map => map.id === query.statsMap)?.id ?? null,
    side: query.statsSide === "ct" || query.statsSide === "t" ? query.statsSide : "overall",
    view: query.statsView === "detailed" ? "detailed" : "compact",
    playerId: typeof query.statsPlayer === "string" && playerIds.has(query.statsPlayer)
      ? query.statsPlayer : preferredPlayerId && playerIds.has(preferredPlayerId) ? preferredPlayerId : players[0]?.userId ?? null,
  };
}

/** Keep other page functions and the existing, narrowly allowed return context. */
export function matchStatsHref(seasonSlug: string, matchId: string, query: MatchStatsQuery, scope: MatchStatsScope, patch: Partial<MatchStatsScope> = {}, anchor = "match-stats") {
  const next = { ...scope, ...patch };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (["statsMap", "statsSide", "statsView", "statsPlayer", "returnTo", "fromStats"].includes(key)) continue;
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  }
  const returnTo = safeBetReturn(typeof query.returnTo === "string" ? query.returnTo : undefined, seasonSlug);
  if (returnTo) params.set("returnTo", returnTo);
  const fromStats = safeStatsReturn(typeof query.fromStats === "string" ? query.fromStats : undefined);
  if (fromStats) params.set("fromStats", fromStats);
  if (next.mapId) params.set("statsMap", next.mapId);
  if (next.side !== "overall") params.set("statsSide", next.side);
  if (next.view !== "compact") params.set("statsView", next.view);
  if (next.playerId) params.set("statsPlayer", next.playerId);
  const suffix = params.toString();
  return `/${seasonSlug}/matches/${matchId}${suffix ? `?${suffix}` : ""}#${anchor}`;
}

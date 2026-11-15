import { SUPPORTED_CS2_MAP_KEYS } from "@/lib/config/cs2-maps";
import { safeStatsReturn } from "@/lib/stats/return-context";
import {
  parsePlayerProfileSection,
  playerProfileHref,
  type PlayerPerformanceSearch,
} from "./performance-view-state";

export interface PlayerMatchesQuery {
  event: string;
  map: string;
  page: number;
  cursor: string;
  direction: "older" | "newer";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePlayerMatchesCursor(
  value: string,
): { date: string | null; matchId: string } | null {
  const [date, matchId, extra] = value.split("|");
  if (extra !== undefined || !matchId || !UUID.test(matchId)) return null;
  if (date !== "none") {
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/.test(date) ||
      !Number.isFinite(Date.parse(date))
    )
      return null;
    // Date.parse normalizes invalid calendar days; PostgreSQL correctly rejects
    // them. Reject here while retaining the original microseconds for SQL.
    if (new Date(date).toISOString().slice(0, 23) !== date.slice(0, 23)) return null;
  }
  return { date: date === "none" ? null : date, matchId };
}

export function parsePlayerMatchesQuery(search: PlayerPerformanceSearch): PlayerMatchesQuery {
  const value = (key: string) => (typeof search[key] === "string" ? (search[key] as string) : "");
  const event = value("event");
  const map = value("map");
  const cursor = value("cursor");
  const page = Number(value("page"));
  const validCursor = parsePlayerMatchesCursor(cursor);
  return {
    page: validCursor && Number.isSafeInteger(page) && page > 0 ? page : 1,
    event: /^[a-z0-9][a-z0-9-]{0,127}$/.test(event) ? event : "",
    map: SUPPORTED_CS2_MAP_KEYS.some((key) => key === map) ? map : "",
    cursor: validCursor ? cursor : "",
    direction: validCursor && value("direction") === "newer" ? "newer" : "older",
  };
}

export function playerMatchesHref(
  userId: string,
  query: PlayerMatchesQuery,
  fromStats?: string | null,
) {
  const params = new URLSearchParams();
  if (query.event) params.set("event", query.event);
  if (query.map) params.set("map", query.map);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.cursor) {
    params.set("cursor", query.cursor);
    if (query.direction === "newer") params.set("direction", "newer");
  }
  const from = safeStatsReturn(fromStats);
  if (from) params.set("fromStats", from);
  return `/players/${userId}/matches${params.size ? `?${params}` : ""}`;
}

/** Alias redirects keep the current entrypoint and only its recognized scope. */
export function canonicalPlayerHref(
  userId: string,
  search: PlayerPerformanceSearch,
  history = false,
) {
  const query = parsePlayerMatchesQuery(search);
  const from = safeStatsReturn(typeof search.fromStats === "string" ? search.fromStats : null);
  if (history) return playerMatchesHref(userId, query, from);
  return playerProfileHref(userId, query, parsePlayerProfileSection(search.section), from);
}

export function playerMatchDetailHref(
  seasonSlug: string,
  matchId: string,
  userId: string,
  mapId?: string,
  fromStats?: string | null,
) {
  const params = new URLSearchParams();
  if (mapId) params.set("statsMap", mapId);
  params.set("statsPlayer", userId);
  const from = safeStatsReturn(fromStats);
  if (from) params.set("fromStats", from);
  return `/${seasonSlug}/matches/${matchId}?${params}#match-stats`;
}

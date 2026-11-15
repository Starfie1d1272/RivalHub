import { safeStatsReturn } from "@/lib/stats/return-context";

export interface PlayerPerformanceQuery {
  event: string;
  map: string;
}

export interface PlayerPerformanceEventOption {
  slug: string;
  maps: readonly string[];
}

export type PlayerPerformanceSearch = Record<string, string | string[] | undefined>;

export type PlayerProfileSection = "overview" | "stats" | "profile";

export function parsePlayerProfileSection(
  value: string | string[] | undefined,
): PlayerProfileSection {
  return value === "stats" || value === "profile" ? value : "overview";
}

export function playerProfileHref(
  userId: string,
  query: PlayerPerformanceQuery,
  section: PlayerProfileSection = "overview",
  fromStats?: string | null,
) {
  const params = new URLSearchParams();
  if (section !== "overview") params.set("section", section);
  if (query.event) params.set("event", query.event);
  if (query.map) params.set("map", query.map);
  const from = safeStatsReturn(fromStats);
  if (from) params.set("fromStats", from);
  return `/players/${userId}${params.size ? `?${params}` : ""}`;
}

export function parsePlayerPerformanceQuery(
  search: PlayerPerformanceSearch,
): PlayerPerformanceQuery {
  const value = (key: string) => (typeof search[key] === "string" ? (search[key] as string) : "");
  const requestedMap = value("map");
  return {
    event: value("event"),
    map: /^de_[a-z0-9_]+$/.test(requestedMap) ? requestedMap : "",
  };
}

export function playerPerformanceHref(
  userId: string,
  current: PlayerPerformanceQuery,
  updates: Partial<PlayerPerformanceQuery>,
  events: readonly PlayerPerformanceEventOption[],
  fromStats?: string | null,
  section: PlayerProfileSection = "overview",
) {
  const event = updates.event ?? current.event;
  const eventOption = event ? events.find((candidate) => candidate.slug === event) : undefined;
  const permittedMaps = eventOption?.maps ?? events.flatMap((candidate) => candidate.maps);
  const requestedMap = updates.map ?? current.map;
  const map = permittedMaps.includes(requestedMap) ? requestedMap : "";
  return playerProfileHref(userId, { event: eventOption?.slug ?? "", map }, section, fromStats);
}

export interface PlayerPerformanceQuery {
  event: string;
  map: string;
}

export interface PlayerPerformanceEventOption {
  slug: string;
  maps: readonly string[];
}

export type PlayerPerformanceSearch = Record<string, string | string[] | undefined>;

export function parsePlayerPerformanceQuery(search: PlayerPerformanceSearch): PlayerPerformanceQuery {
  const value = (key: string) => typeof search[key] === "string" ? search[key] as string : "";
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
) {
  const event = updates.event ?? current.event;
  const eventOption = event ? events.find((candidate) => candidate.slug === event) : undefined;
  const permittedMaps = eventOption?.maps ?? events.flatMap((candidate) => candidate.maps);
  const requestedMap = updates.map ?? current.map;
  const map = permittedMaps.includes(requestedMap) ? requestedMap : "";
  const params = new URLSearchParams();
  if (eventOption) params.set("event", eventOption.slug);
  if (map) params.set("map", map);
  const query = params.toString();
  return `/players/${userId}${query ? `?${query}` : ""}`;
}

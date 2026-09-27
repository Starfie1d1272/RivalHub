import type { Route } from "next";

export const STATS_TABS = { overview: "Overview", players: "Players", teams: "Teams", maps: "Maps", weapons: "Weapons" } as const;
export type StatsTab = keyof typeof STATS_TABS;
export type StatsMatchFormat = "" | "bo1" | "bo3" | "bo5";
export type StatsSearch = Record<string, string | string[] | undefined>;

export interface StatsQuery {
  tab: StatsTab;
  stage: string;
  format: StatsMatchFormat;
  mapFilter: string;
  teamFilter: string;
  player: string;
  team: string;
  map: string;
  mapsView: "pool" | "veto";
}

export type StatsQueryUpdates = Partial<StatsQuery>;
const mapKeyPattern = /^de_[a-z0-9_]+$/;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseStatsQuery(raw: StatsSearch, stages: readonly string[]): StatsQuery {
  const value = (key: string) => typeof raw[key] === "string" ? raw[key] as string : "";
  const requestedTab = value("tab");
  const requestedFormat = value("format");
  const tab = Object.hasOwn(STATS_TABS, requestedTab) ? requestedTab as StatsTab : "overview";
  const format: StatsMatchFormat = requestedFormat === "bo1" || requestedFormat === "bo3" || requestedFormat === "bo5" ? requestedFormat : "";
  return {
    tab,
    stage: stages.includes(value("stage")) ? value("stage") : "",
    format,
    mapFilter: mapKeyPattern.test(value("mapFilter")) ? value("mapFilter") : "",
    teamFilter: (tab === "players" || tab === "weapons") && idPattern.test(value("teamFilter")) ? value("teamFilter") : "",
    player: "",
    team: "",
    map: tab === "maps" && mapKeyPattern.test(value("map")) ? value("map") : "",
    mapsView: tab === "maps" && value("mapsView") === "veto" ? "veto" : "pool",
  };
}

function serializeStatsQuery(query: StatsQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.tab !== "overview") params.set("tab", query.tab);
  if (query.stage) params.set("stage", query.stage);
  if (query.format) params.set("format", query.format);
  if ((query.tab === "players" || query.tab === "teams" || query.tab === "weapons") && query.mapFilter) params.set("mapFilter", query.mapFilter);
  if ((query.tab === "players" || query.tab === "weapons") && query.teamFilter) params.set("teamFilter", query.teamFilter);
  if (query.tab === "maps" && query.map) params.set("map", query.map);
  if (query.tab === "maps" && query.mapsView === "veto") params.set("mapsView", "veto");
  return params;
}

export function statsHref(slug: string, current: StatsQuery, updates: StatsQueryUpdates = {}): Route {
  const nextTab = updates.tab && Object.hasOwn(STATS_TABS, updates.tab) ? updates.tab : current.tab;
  let next: StatsQuery = nextTab === current.tab
    ? { ...current }
    : { tab: nextTab, stage: current.stage, format: current.format, mapFilter: "", teamFilter: "", player: "", team: "", map: "", mapsView: "pool" };

  if (Object.hasOwn(updates, "stage") && updates.stage !== current.stage) {
    next = { tab: nextTab, stage: updates.stage ?? "", format: current.format, mapFilter: "", teamFilter: "", player: "", team: "", map: "", mapsView: "pool" };
  }
  if (Object.hasOwn(updates, "format") && updates.format !== current.format) {
    next = { tab: nextTab, stage: next.stage, format: updates.format ?? "", mapFilter: "", teamFilter: "", player: "", team: "", map: "", mapsView: "pool" };
  }
  if (Object.hasOwn(updates, "mapFilter")) {
    next.mapFilter = updates.mapFilter ?? "";
    next.player = "";
    if (nextTab === "teams") next.team = "";
  }
  if (Object.hasOwn(updates, "teamFilter") && (nextTab === "players" || nextTab === "weapons")) {
    next.teamFilter = updates.teamFilter ?? "";
    next.player = "";
  }
  if (Object.hasOwn(updates, "map") && nextTab === "maps") next.map = updates.map ?? "";
  if (Object.hasOwn(updates, "mapsView") && nextTab === "maps") next.mapsView = updates.mapsView ?? "pool";

  const params = serializeStatsQuery(next);
  return `/${slug}/stats${params.size ? `?${params.toString()}` : ""}` as Route;
}

export interface StatsScopeRouter {
  push(href: string | Route, options?: { scroll?: boolean }): void;
}

export function navigateStatsScope(router: StatsScopeRouter, slug: string, query: StatsQuery, updates: StatsQueryUpdates): Route {
  const href = statsHref(slug, query, updates);
  router.push(href, { scroll: false });
  return href;
}

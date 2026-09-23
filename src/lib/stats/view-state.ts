import type { Route } from "next";

export const STATS_TABS = { overview: "Overview", players: "Players", teams: "Teams", maps: "Maps" } as const;
export type StatsTab = keyof typeof STATS_TABS;
export type StatsSearch = Record<string, string | string[] | undefined>;

export interface StatsQuery {
  tab: StatsTab;
  stage: string;
  mapFilter: string;
  teamFilter: string;
  player: string;
  team: string;
  map: string;
}

export type StatsQueryUpdates = Partial<StatsQuery>;
const mapKeyPattern = /^de_[a-z0-9_]+$/;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseStatsQuery(raw: StatsSearch, stages: readonly string[]): StatsQuery {
  const value = (key: string) => typeof raw[key] === "string" ? raw[key] as string : "";
  const requestedTab = value("tab");
  const tab = Object.hasOwn(STATS_TABS, requestedTab) ? requestedTab as StatsTab : "overview";
  return {
    tab,
    stage: stages.includes(value("stage")) ? value("stage") : "",
    mapFilter: mapKeyPattern.test(value("mapFilter")) ? value("mapFilter") : "",
    teamFilter: tab === "players" && idPattern.test(value("teamFilter")) ? value("teamFilter") : "",
    player: "",
    team: tab === "teams" && idPattern.test(value("team")) ? value("team") : "",
    map: tab === "maps" && mapKeyPattern.test(value("map")) ? value("map") : "",
  };
}

function serializeStatsQuery(query: StatsQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.tab !== "overview") params.set("tab", query.tab);
  if (query.stage) params.set("stage", query.stage);
  if ((query.tab === "players" || query.tab === "teams") && query.mapFilter) params.set("mapFilter", query.mapFilter);
  if (query.tab === "players" && query.teamFilter) params.set("teamFilter", query.teamFilter);
  if (query.tab === "teams" && query.team) params.set("team", query.team);
  if (query.tab === "maps" && query.map) params.set("map", query.map);
  return params;
}

export function statsHref(slug: string, current: StatsQuery, updates: StatsQueryUpdates = {}): Route {
  const nextTab = updates.tab && Object.hasOwn(STATS_TABS, updates.tab) ? updates.tab : current.tab;
  let next: StatsQuery = nextTab === current.tab
    ? { ...current }
    : { tab: nextTab, stage: current.stage, mapFilter: "", teamFilter: "", player: "", team: "", map: "" };

  if (Object.hasOwn(updates, "stage") && updates.stage !== current.stage) {
    next = { tab: nextTab, stage: updates.stage ?? "", mapFilter: "", teamFilter: "", player: "", team: "", map: "" };
  }
  if (Object.hasOwn(updates, "mapFilter")) {
    next.mapFilter = updates.mapFilter ?? "";
    next.player = "";
    if (nextTab === "teams") next.team = "";
  }
  if (Object.hasOwn(updates, "teamFilter") && nextTab === "players") {
    next.teamFilter = updates.teamFilter ?? "";
    next.player = "";
  }
  if (Object.hasOwn(updates, "team") && nextTab === "teams") next.team = updates.team ?? "";
  if (Object.hasOwn(updates, "map") && nextTab === "maps") next.map = updates.map ?? "";

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

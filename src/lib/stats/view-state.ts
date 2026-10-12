import type { Route } from "next";

export const STATS_TABS = { overview: "Overview", players: "Players", teams: "Teams", maps: "Maps", weapons: "Weapons", records: "Records" } as const;
export type StatsTab = keyof typeof STATS_TABS;
export type StatsMatchFormat = "" | "bo1" | "bo3" | "bo5";
export type StatsSearch = Record<string, string | string[] | undefined>;

export interface StatsQuery {
  recordPage?: number;
  sort?: string;
  direction?: "asc" | "desc";
  page?: number;
  family?: string;
  q?: string;
  preview?: boolean;
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
  const value = (key: string) => typeof raw[key] === "string" && raw[key].length <= 128 ? raw[key] as string : "";
  const requestedTab = value("tab");
  const requestedFormat = value("format");
  const tab = Object.hasOwn(STATS_TABS, requestedTab) ? requestedTab as StatsTab : !requestedTab && value("map") ? "maps" : "overview";
  const format: StatsMatchFormat = requestedFormat === "bo1" || requestedFormat === "bo3" || requestedFormat === "bo5" ? requestedFormat : "";
  return {
    tab,
    sort: /^[a-zA-Z0-9_-]{1,40}$/.test(value("sort")) ? value("sort") : "",
    direction: value("direction") === "asc" ? "asc" : "desc",
    page: /^[1-9][0-9]{0,3}$/.test(value("page")) ? Number(value("page")) : 1,
    family: ["overall", "opening", "teamplay", "utility", "clutch", "results", "rounds", "conversion"].includes(value("family")) ? value("family") : "",
    q: value("q"),
    stage: value("stage") ? stages.includes(value("stage")) ? value("stage") : "__invalid__" : "",
    format,
    mapFilter: value("mapFilter") ? mapKeyPattern.test(value("mapFilter")) ? value("mapFilter") : "__invalid__" : "",
    teamFilter: (tab === "players" || tab === "weapons") && idPattern.test(value("teamFilter")) ? value("teamFilter") : "",
    player: "",
    team: "",
    map: tab === "maps" && mapKeyPattern.test(value("map")) ? value("map") : "",
    mapsView: tab === "maps" && value("mapsView") === "veto" ? "veto" : "pool",
  };
}

function serializeStatsQuery(query: StatsQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.sort) params.set("sort", query.sort);
  if (query.sort && query.direction === "asc") params.set("direction", "asc");
  if (query.page && query.page > 1) params.set("page", String(query.page));
  if (query.family) params.set("family", query.family);
  if (query.q) params.set("q", query.q);
  if (query.tab !== "overview") params.set("tab", query.tab);
  if (query.stage) params.set("stage", query.stage);
  if (query.format) params.set("format", query.format);
  if (query.mapFilter) params.set("mapFilter", query.mapFilter);
  if ((query.tab === "players" || query.tab === "weapons") && query.teamFilter) params.set("teamFilter", query.teamFilter);
  if (query.tab === "maps" && query.map) params.set("map", query.map);
  if (query.tab === "records" && query.recordPage && query.recordPage > 1) params.set("recordPage", String(query.recordPage));
  if (query.tab === "maps" && query.mapsView === "veto") params.set("mapsView", "veto");
  return params;
}

export function statsHref(slug: string, current: StatsQuery, updates: StatsQueryUpdates = {}): Route {
  const nextTab = updates.tab && Object.hasOwn(STATS_TABS, updates.tab) ? updates.tab : current.tab;
  let next: StatsQuery = nextTab === current.tab
    ? { ...current }
    : { tab: nextTab, stage: current.stage, format: current.format, mapFilter: current.map || current.mapFilter, teamFilter: "", player: "", team: "", map: "", mapsView: "pool", preview: current.preview };

  if (Object.hasOwn(updates, "stage") && updates.stage !== current.stage) {
    next = { tab: nextTab, stage: updates.stage ?? "", format: current.format, mapFilter: "", teamFilter: "", player: "", team: "", map: "", mapsView: "pool" };
  }
  if (Object.hasOwn(updates, "format") && updates.format !== current.format) {
    next = { tab: nextTab, stage: next.stage, format: updates.format ?? "", mapFilter: "", teamFilter: "", player: "", team: "", map: "", mapsView: "pool" };
  }
  if (Object.hasOwn(updates, "mapFilter")) {
    next.mapFilter = updates.mapFilter ?? "";
    if (next.map && next.map !== next.mapFilter) next.map = "";
    next.player = "";
    if (nextTab === "teams") next.team = "";
  }
  if (Object.hasOwn(updates, "teamFilter") && (nextTab === "players" || nextTab === "weapons")) {
    next.teamFilter = updates.teamFilter ?? "";
    next.player = "";
  }
  if (Object.hasOwn(updates, "map") && nextTab === "maps") {
    next.map = updates.map ?? "";
    if (next.map && next.mapFilter && next.map !== next.mapFilter) next.mapFilter = next.map;
  }
  if (Object.hasOwn(updates, "mapsView") && nextTab === "maps") next.mapsView = updates.mapsView ?? "pool";

  if (updates.recordPage !== undefined && nextTab === "records") next.recordPage = updates.recordPage;
  if (nextTab !== current.tab || updates.stage !== undefined || updates.format !== undefined || updates.mapFilter !== undefined) next.recordPage = 1;
  if (updates.family !== undefined) { next.family = updates.family; next.sort = ""; next.page = 1; }
  if (updates.q !== undefined) { next.q = updates.q; next.page = 1; }
  if (updates.sort !== undefined) next.sort = updates.sort;
  if (updates.direction !== undefined) next.direction = updates.direction;
  if (updates.page !== undefined) next.page = updates.page;
  const params = serializeStatsQuery(next);
  if (slug && !current.preview) params.set("event", slug);
  const path = current.preview ? `/${slug}/stats` : "/stats";
  return `${path}${params.size ? `?${params.toString()}` : ""}` as Route;
}

export interface StatsScopeRouter {
  push(href: string | Route, options?: { scroll?: boolean }): void;
}

export function navigateStatsScope(router: StatsScopeRouter, slug: string, query: StatsQuery, updates: StatsQueryUpdates): Route {
  const href = statsHref(slug, query, updates);
  router.push(href, { scroll: false });
  return href;
}

/** Canonical public entry link; authorized draft adapters explicitly opt into preview. */
export function statsEntryHref(slug = "", updates: StatsQueryUpdates = {}, preview = false): Route {
  return statsHref(slug, { ...parseStatsQuery({}, []), preview }, updates);
}

import type { Route } from "next";
import { normalizeLeaderboardState } from "@/lib/matches/leaderboard-view";
import { applyListQueryUpdates, type ListQueryUpdates } from "@/lib/list-query";
import type { StatsSortDirection } from "./sorting";

export const STATS_TABS = { overview: "概览", players: "选手", teams: "队伍", maps: "地图" } as const;
export type StatsTab = keyof typeof STATS_TABS;
export type StatsSearch = Record<string, string | string[] | undefined>;

export const STATS_SORT_KEYS = {
  overview: ["played", "pick", "ban", "decider", "rounds", "t", "ct", "pistol"],
  players: ["maps", "rating", "adr", "kd", "kpr", "hs", "we", "rws", "fk", "mk", "clutch", "fd", "trade", "kast"],
  teams: ["team", "maps", "rounds", "rw", "t", "ct", "pistol", "opening"],
  maps: ["map", "played", "pick", "ban", "decider", "rounds", "t", "ct", "pistol", "mapTeam", "mapTeamPick", "mapTeamBan"],
} as const;

export const STATS_DEFAULT_SORT = {
  overview: "played",
  players: "rating",
  teams: "rw",
  maps: "played",
} as const satisfies Record<StatsTab, string>;

export function defaultStatsSort(tab: StatsTab): string {
  return STATS_DEFAULT_SORT[tab];
}

function normalizeTabSort(tab: StatsTab, rawSort: string): string {
  const valid = STATS_SORT_KEYS[tab] as readonly string[];
  return valid.includes(rawSort) ? rawSort : defaultStatsSort(tab);
}

export function parseStatsQuery(raw: StatsSearch, stages: readonly string[]) {
  const value = (key: string) => typeof raw[key] === "string" ? raw[key] as string : "";
  const tab = Object.hasOwn(STATS_TABS, value("tab")) ? value("tab") as StatsTab : "overview";
  const leaderboard = normalizeLeaderboardState({ sort: value("sort"), view: value("view") });
  const sort = tab === "players" ? leaderboard.sort : normalizeTabSort(tab, value("sort"));
  const view = tab === "players" ? leaderboard.view : "core" as const;
  const direction: StatsSortDirection = value("dir") === "asc" ? "asc" : "desc";
  return { tab, sort, direction, view, stage: stages.includes(value("stage")) ? value("stage") : "", map: /^de_[a-z0-9_]+$/.test(value("map")) ? value("map") : "",
    team: /^[0-9a-f-]{36}$/.test(value("team")) ? value("team") : "", side: value("side") === "t" || value("side") === "ct" ? value("side") as "t" | "ct" : "overall" as const,
    q: value("q").trim().slice(0, 100), page: /^\d+$/.test(value("page")) ? Math.min(Math.max(Number(value("page")), 1), 100000) : 1 };
}
export type StatsQuery = ReturnType<typeof parseStatsQuery>;
export function statsHref(slug: string, query: StatsQuery, updates: ListQueryUpdates = {}) {
  const defaults = { tab: "overview", view: "core", sort: defaultStatsSort(query.tab), dir: "desc", side: "overall", page: 1 };
  const { direction, ...queryWithoutDirection } = query;
  const current = applyListQueryUpdates(new URLSearchParams(), { ...queryWithoutDirection, dir: direction }, { defaults });
  const nextTab = typeof updates.tab === "string" && Object.hasOwn(STATS_TABS, updates.tab) ? updates.tab as StatsTab : query.tab;
  const tabDefaults = Object.hasOwn(updates, "tab") && nextTab !== query.tab
    ? { sort: defaultStatsSort(nextTab), dir: "desc", view: nextTab === "players" ? query.view : "core", page: 1 }
    : {};
  const next = applyListQueryUpdates(current, { ...tabDefaults, ...updates }, { defaults: { ...defaults, ...tabDefaults } });
  return `/${slug}/stats${next.size ? `?${next}` : ""}` as Route;
}

import { describe, expect, it, vi } from "vitest";
import { navigateStatsScope, parseStatsQuery, statsHref } from "./view-state";

const playerId = "4ab08f95-e8e1-4d9e-8641-947dbcc37779";
const teamId = "7c4112a4-6c8c-4c27-a5b2-0824d4b5d294";

describe("stats URL scope", () => {
  it("accepts only shareable scope and entity selection", () => {
    const parsed = parseStatsQuery({
      tab: "players", stage: "swiss", format: "bo3", mapFilter: "de_ancient", teamFilter: teamId,
      player: playerId, sort: "adr", dir: "asc", view: "impact", page: "5", side: "ct", q: "x",
    }, ["swiss"]);
    expect(parsed).toEqual({ tab: "players", stage: "swiss", format: "bo3", mapFilter: "de_ancient", teamFilter: teamId, player: "", team: "", map: "", mapsView: "pool" });
  });

  it("clears entity scope on tab and stage changes while preserving global format", () => {
    const players = parseStatsQuery({ tab: "players", stage: "swiss", format: "bo3", mapFilter: "de_ancient", teamFilter: teamId, player: playerId }, ["swiss"]);
    const teamTab = new URL(statsHref("major", players, { tab: "teams" }), "https://example.test");
    expect([...teamTab.searchParams]).toEqual([["tab", "teams"], ["stage", "swiss"], ["format", "bo3"]]);

    const stageChanged = new URL(statsHref("major", players, { stage: "playoff" }), "https://example.test");
    expect([...stageChanged.searchParams]).toEqual([["tab", "players"], ["stage", "playoff"], ["format", "bo3"]]);
  });

  it("treats Best-of as global scope and clears dependent entity filters when it changes", () => {
    const players = parseStatsQuery({ tab: "players", stage: "swiss", format: "bo1", mapFilter: "de_ancient", teamFilter: teamId }, ["swiss"]);
    const changed = new URL(statsHref("major", players, { format: "bo3" }), "https://example.test");
    expect([...changed.searchParams]).toEqual([["tab", "players"], ["stage", "swiss"], ["format", "bo3"]]);
    expect(parseStatsQuery({ format: "bo7" }, []).format).toBe("");
  });

  it("ignores the retired stats player selection while preserving directory scope", () => {
    const players = parseStatsQuery({ tab: "players", stage: "swiss", mapFilter: "de_ancient", teamFilter: teamId, player: playerId }, ["swiss"]);
    const changedFilter = new URL(statsHref("major", players, { mapFilter: "de_mirage" }), "https://example.test");
    expect([...changedFilter.searchParams]).toEqual([["tab", "players"], ["stage", "swiss"], ["mapFilter", "de_mirage"], ["teamFilter", teamId]]);
    const stalePlayerUpdate = new URL(statsHref("major", players, { player: playerId }), "https://example.test");
    expect([...stalePlayerUpdate.searchParams]).toEqual([["tab", "players"], ["stage", "swiss"], ["mapFilter", "de_ancient"], ["teamFilter", teamId]]);
  });

  it("keeps map detail selection but retires stats-only team selection", () => {
    const overview = parseStatsQuery({ tab: "overview", stage: "swiss" }, ["swiss"]);
    const map = new URL(statsHref("major", overview, { tab: "maps", map: "de_ancient" }), "https://example.test");
    expect([...map.searchParams]).toEqual([["tab", "maps"], ["stage", "swiss"], ["map", "de_ancient"]]);
    const selectedMap = parseStatsQuery({ tab: "maps", stage: "swiss", map: "de_ancient" }, ["swiss"]);
    const teams = new URL(statsHref("major", selectedMap, { tab: "teams", mapFilter: "de_ancient", team: teamId }), "https://example.test");
    expect([...teams.searchParams]).toEqual([["tab", "teams"], ["stage", "swiss"], ["mapFilter", "de_ancient"]]);
  });

  it("supports weapons filters and a shareable veto view", () => {
    const overview = parseStatsQuery({ tab: "overview", stage: "swiss" }, ["swiss"]);
    const weapons = new URL(statsHref("major", overview, { tab: "weapons", mapFilter: "de_ancient", teamFilter: teamId }), "https://example.test");
    expect([...weapons.searchParams]).toEqual([["tab", "weapons"], ["stage", "swiss"], ["mapFilter", "de_ancient"], ["teamFilter", teamId]]);

    const maps = parseStatsQuery({ tab: "maps", stage: "swiss", mapsView: "veto" }, ["swiss"]);
    expect(maps.mapsView).toBe("veto");
    expect([...new URL(statsHref("major", maps), "https://example.test").searchParams]).toEqual([["tab", "maps"], ["stage", "swiss"], ["mapsView", "veto"]]);
  });

  it("keeps browser navigation URL-backed while suppressing scope-change scroll resets", () => {
    const query = parseStatsQuery({ tab: "players", stage: "swiss", teamFilter: teamId }, ["swiss"]);
    const router = { push: vi.fn() };
    const href = navigateStatsScope(router, "major", query, { mapFilter: "de_ancient" });

    expect(router.push).toHaveBeenCalledWith(href, { scroll: false });
    expect(href).toContain("mapFilter=de_ancient");
  });
});

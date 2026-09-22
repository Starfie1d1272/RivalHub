import { describe, expect, it } from "vitest";
import { parseStatsQuery, statsHref } from "./query-state";
describe("stats URL scope", () => {
  it("normalizes invalid values and preserves map/team scope across navigation", () => {
    const query = parseStatsQuery({ tab: "bad", stage: "other", page: "NaN", side: "bad" }, ["swiss"]);
    expect(query).toMatchObject({ tab: "overview", stage: "", page: 1, side: "overall", sort: "played", direction: "desc" });
    const scoped = parseStatsQuery({ tab: "players", stage: "swiss", map: "de_ancient", page: "3" }, ["swiss"]);
    const url = new URL(statsHref("major", scoped, { sort: "adr" }), "https://example.test");
    expect(url.searchParams.get("map")).toBe("de_ancient");
    expect(url.searchParams.get("stage")).toBe("swiss");
    expect(url.searchParams.has("page")).toBe(false);
    expect(url.searchParams.get("dir")).toBeNull();
    expect(statsHref("major", scoped, { page: 4 })).toContain("page=4");
  });

  it("validates sort per tab and round-trips direction while resetting page", () => {
    const maps = parseStatsQuery({ tab: "maps", sort: "rating", dir: "asc", page: "4" }, []);
    expect(maps).toMatchObject({ sort: "played", direction: "asc", page: 4 });
    const url = new URL(statsHref("major", maps, { sort: "pick", dir: "asc" }), "https://example.test");
    expect(url.searchParams.get("sort")).toBe("pick");
    expect(url.searchParams.get("dir")).toBe("asc");
    expect(url.searchParams.get("direction")).toBeNull();
    expect(url.searchParams.has("page")).toBe(false);
    const players = parseStatsQuery({ tab: "players", sort: "adr", dir: "asc", page: "2" }, []);
    const mapsUrl = new URL(statsHref("major", players, { tab: "maps" }), "https://example.test");
    expect(mapsUrl.searchParams.get("sort")).toBeNull();
    expect(mapsUrl.searchParams.get("dir")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { parseStatsQuery, statsHref } from "./query-state";
describe("stats URL scope", () => {
  it("normalizes invalid values and preserves map/team scope across navigation", () => {
    const query = parseStatsQuery({ tab: "bad", stage: "other", page: "NaN", side: "bad" }, ["swiss"]);
    expect(query).toMatchObject({ tab: "overview", stage: "", page: 1, side: "overall" });
    const scoped = parseStatsQuery({ tab: "players", stage: "swiss", map: "de_ancient", page: "3" }, ["swiss"]);
    const url = new URL(statsHref("major", scoped, { sort: "adr" }), "https://example.test");
    expect(url.searchParams.get("map")).toBe("de_ancient");
    expect(url.searchParams.get("stage")).toBe("swiss");
    expect(url.searchParams.has("page")).toBe(false);
    expect(statsHref("major", scoped, { page: 4 })).toContain("page=4");
  });
});

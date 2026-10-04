import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isReservedSeasonSlug, PLATFORM_ROUTE_SEGMENTS } from "./slug";
describe("platform season slug reservations", () => {
  it("reserves every top-level static route and permits similar event prefixes", () => {
    const routes = readdirSync("src/app", { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith("[") && !entry.name.startsWith("("));
    for (const route of routes) expect(PLATFORM_ROUTE_SEGMENTS, route.name).toContain(route.name);
    expect(isReservedSeasonSlug("stats")).toBe(true);
    expect(isReservedSeasonSlug("stats-2026")).toBe(false);
  });
});

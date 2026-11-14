import { expect, it } from "vitest";
import { parsePlayerPerformanceQuery, playerPerformanceHref, parsePlayerProfileSection, playerProfileHref } from "./performance-view-state";
import { canonicalPlayerHref } from "./matches-view-state";

// Changing profile scope must retain the original leaderboard's filters and page.
it("keeps the original stats return destination through event and map changes", () => {
  const fromStats = "/stats?event=major&tab=players&sort=adr&direction=desc&page=2&q=Alice";
  const events = [
    { slug: "major", maps: ["de_mirage"] },
    { slug: "rivals", maps: ["de_ancient"] },
  ];
  let search = new URLSearchParams({ event: "major", map: "de_mirage", fromStats });
  for (const updates of [{ event: "rivals" }, { map: "de_ancient" }, { event: "", map: "" }]) {
    const href = playerPerformanceHref("alice", parsePlayerPerformanceQuery(Object.fromEntries(search)), updates, events, search.get("fromStats"));
    search = new URL(href, "https://rivalhub.invalid").searchParams;
    expect(search.get("fromStats")).toBe(fromStats);
  }
  expect(search.has("event")).toBe(false);
  expect(search.has("map")).toBe(false);
});

it("does not add a return destination for direct visits or invalid destinations", () => {
  for (const fromStats of [undefined, "/admin?event=major", "https://example.com/stats?event=major"]) {
    expect(playerPerformanceHref("alice", { event: "", map: "" }, {}, [], fromStats)).toBe("/players/alice");
  }
});

// Section navigation must not silently reset the sample or an upstream leaderboard.
it("preserves the statistics section when its scope changes or its player alias redirects", () => {
  const fromStats = "/stats?tab=players&page=2";
  const href = playerPerformanceHref("alias", { event: "major", map: "de_mirage" }, { event: "rivals" }, [
    { slug: "major", maps: ["de_mirage"] },
    { slug: "rivals", maps: ["de_ancient"] },
  ], fromStats, "stats");
  const search = Object.fromEntries(new URL(href, "https://rivalhub.invalid").searchParams);
  expect(search).toEqual({ section: "stats", event: "rivals", fromStats });
  expect(canonicalPlayerHref("canonical", search)).toBe(playerProfileHref("canonical", { event: "rivals", map: "" }, "stats", fromStats));
  expect(parsePlayerProfileSection(["stats", "profile"])).toBe("overview");
  expect(parsePlayerProfileSection("unknown")).toBe("overview");
});

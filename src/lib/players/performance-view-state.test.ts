import { expect, it } from "vitest";
import { parsePlayerPerformanceQuery, playerPerformanceHref } from "./performance-view-state";
import { canonicalPlayerHref, parsePlayerMatchesCursor, parsePlayerMatchesQuery, playerMatchDetailHref, playerMatchesHref } from "./matches-view-state";

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

// A history cursor is an exact DB ordering boundary, not a millisecond JS Date.
it("restores history filters and both pagination directions without rounding PostgreSQL microseconds", () => {
  const matchId = "00000000-0000-4000-8000-000000000001";
  const fromStats = "/stats?event=major&tab=players&page=3&mapFilter=de_mirage";
  for (const direction of ["older", "newer"] as const) {
    const cursor = `2026-11-04T01:02:03.123456Z|${matchId}`;
    const query = parsePlayerMatchesQuery({ event: "major", map: "de_mirage", page: "2", cursor, direction });
    const destination = new URL(playerMatchesHref("canonical-player", query, fromStats), "https://rivalhub.invalid");
    expect(parsePlayerMatchesQuery(Object.fromEntries(destination.searchParams))).toEqual(query);
    expect(parsePlayerMatchesCursor(destination.searchParams.get("cursor")!)).toEqual({ date: "2026-11-04T01:02:03.123456Z", matchId });
    expect(destination.searchParams.get("fromStats")).toBe(fromStats);
  }
  expect(parsePlayerMatchesCursor(`none|${matchId}`)).toEqual({ date: null, matchId });
  expect(parsePlayerMatchesCursor(`2026-02-30T01:02:03.123456Z|${matchId}`)).toBeNull();
  expect(parsePlayerMatchesQuery({ page: "999999", cursor: "invalid", map: "de_mirage" }))
    .toMatchObject({ page: 1, cursor: "", direction: "older", map: "de_mirage" });
});

it("keeps canonical aliases on the history entrypoint with their scope and rejects unrelated return targets", () => {
  const search = { event: "major", map: "de_mirage", page: "2", direction: "newer",
    cursor: "2026-11-04T01:02:03.123456Z|00000000-0000-4000-8000-000000000001",
    fromStats: "/stats?event=major&tab=players&page=3" };
  const history = new URL(canonicalPlayerHref("canonical-player", search, true), "https://rivalhub.invalid");
  expect(history.pathname).toBe("/players/canonical-player/matches");
  expect(Object.fromEntries(history.searchParams)).toEqual(search);
  const profile = new URL(canonicalPlayerHref("canonical-player", search), "https://rivalhub.invalid");
  expect(profile.pathname).toBe("/players/canonical-player");
  expect(Object.fromEntries(profile.searchParams)).toEqual({ event: search.event, map: search.map, fromStats: search.fromStats });
  for (const fromStats of ["/admin?event=major", "https://example.com/stats?event=major"]) {
    expect(new URL(canonicalPlayerHref("canonical-player", { ...search, fromStats }, true), "https://rivalhub.invalid").searchParams.has("fromStats")).toBe(false);
  }
});

it("links series-only history without inventing a map while confirmed map links retain the selected player", () => {
  const fromStats = "/stats?event=major&tab=players&page=3";
  const series = new URL(playerMatchDetailHref("major", "match", "player", undefined, fromStats), "https://rivalhub.invalid");
  expect(series.searchParams.has("statsMap")).toBe(false);
  expect(series.searchParams.get("statsPlayer")).toBe("player");
  const map = new URL(playerMatchDetailHref("major", "match", "player", "confirmed-map", fromStats), "https://rivalhub.invalid");
  expect(map.pathname).toBe(series.pathname);
  expect(Object.fromEntries(map.searchParams)).toEqual({ statsMap: "confirmed-map", statsPlayer: "player", fromStats });
  expect(map.hash).toBe("#match-stats");
});

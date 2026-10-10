import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MatchSummaryStats, type SummaryPlayer } from "./MatchSummaryStats";
import { PlayerStatsTable } from "./PlayerStatsTable";

vi.mock("next/navigation", () => ({ useParams: () => ({ seasonSlug: "synthetic-cup" }) }));

const player = (teamId: string, perfectName: string, userId: string | null): SummaryPlayer => ({
  teamId, perfectName, userId, kills: 12, deaths: 8, assists: 3, hsPercent: 40,
  firstKills: 1, multiKills: 2, clutches: 0, adr: 72.5, rws: null, ratingPro: 1.1, we: null,
  mapsPlayed: 1,
});

// The formatter matrix belongs to its owner; this checks the two actual consumer paths,
// correct team assignment, stable profile navigation, and untouched source rows.
describe("match result nickname presentation", () => {
  it.each(["summary", "map"])("keeps %s names scoped to their team without changing identity or statistics", (surface) => {
    const players = [
      player("a", "Alpha | 同名🎮", "player-a"),
      player("b", "【Bravo】 · 同名🎮", "player-b"),
      player("a", "Bravo | Unknown", null),
    ];
    const before = structuredClone(players);
    const props = { players, entryAId: "a", entryBId: "b", teamAName: "Alpha", teamBName: "Bravo" };
    render(surface === "summary" ? <MatchSummaryStats {...props} /> : <PlayerStatsTable {...props} />);
    const names = screen.getAllByRole("link", { name: "同名🎮" });
    expect(names.map(link => link.getAttribute("href"))).toEqual(["/players/player-a", "/players/player-b"]);
    expect(names.map(link => link.getAttribute("title"))).toEqual(["Alpha | 同名🎮", "【Bravo】 · 同名🎮"]);
    expect(screen.getByText("Bravo | Unknown")).toBeVisible();
    expect(screen.getAllByText("12")).toHaveLength(3);
    expect(players).toEqual(before);
    cleanup();
  });
});

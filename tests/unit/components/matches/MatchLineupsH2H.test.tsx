/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MatchLineupsH2H } from "@/components/matches/MatchLineupsH2H";

const basePlayer = {
  userId: "user-1",
  perfectName: "Player",
  maps: 2,
  avgRating: null,
  avgAdr: null,
  kdRatio: null,
  avgHs: null,
  fkpr: null,
  avgWe: null,
};

describe("MatchLineupsH2H", () => {
  it("does not compare unknown metrics", () => {
    const { container } = render(
      <MatchLineupsH2H
        teamAName="队伍 A"
        teamBName="队伍 B"
        teamAPlayers={[basePlayer]}
        teamBPlayers={[{ ...basePlayer, userId: "user-2", perfectName: "Opponent" }]}
      />,
    );

    expect(screen.getAllByText("—")).toHaveLength(13);
    expect(container.querySelectorAll(".h-1\\.5")).toHaveLength(0);
  });

  it("keeps real zero visible in both values and the comparison bar", () => {
    const { container } = render(
      <MatchLineupsH2H
        teamAName="队伍 A"
        teamBName="队伍 B"
        teamAPlayers={[{ ...basePlayer, avgRating: 0, avgAdr: 0, kdRatio: 0, avgHs: 0, fkpr: 0, avgWe: 0 }]}
        teamBPlayers={[{ ...basePlayer, userId: "user-2", perfectName: "Opponent", avgRating: 0, avgAdr: 0, kdRatio: 0, avgHs: 0, fkpr: 0, avgWe: 0 }]}
      />,
    );

    expect(screen.getAllByText("0.00").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("0.0").length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText("0%").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll(".h-1\\.5")).toHaveLength(6);
  });
});

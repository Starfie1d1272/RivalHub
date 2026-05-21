import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatsLeaderboard } from "./StatsLeaderboard";

const row = {
  userId: "player-1",
  perfectName: "Star Entry",
  position: "awper",
  teamName: "Rival Orange",
  teamId: "team-1",
  maps: 8,
  avgRating: 1.21,
  avgAdr: 82.4,
  avgRws: 10.18,
  avgWe: 13.5,
  avgHs: 48.2,
  kdRatio: 1.34,
  kpr: 0.81,
  fkpr: 0.19,
  mkpr: 0.12,
  cpr: 0.04,
};

describe("StatsLeaderboard", () => {
  it("shows compact core metrics and English position text by default", () => {
    render(
      <StatsLeaderboard
        rows={[row]}
        sort="rating"
        position=""
        seasonSlug="spring"
        view="core"
      />,
    );

    expect(screen.getByRole("columnheader", { name: "Pos" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "AWPer" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "HS%" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "FKPR /100r" })).not.toBeInTheDocument();
  });

  it("shows impact metrics in the impact view", () => {
    render(
      <StatsLeaderboard
        rows={[row]}
        sort="fk"
        position=""
        seasonSlug="spring"
        view="impact"
      />,
    );

    expect(screen.getByRole("columnheader", { name: "FKPR /100r" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "MKPR /100r" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "HS%" })).not.toBeInTheDocument();
  });
});

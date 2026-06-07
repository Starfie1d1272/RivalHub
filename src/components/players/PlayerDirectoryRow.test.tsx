import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlayerDirectoryRow } from "./PlayerDirectoryRow";

const player = {
  userId: "player-1",
  registrationId: "registration-1",
  displayName: "Star Entry",
  primaryPosition: "opener",
  secondaryPosition: "closer",
  peakRank: "S",
  peakRating: 1.42,
  currentRank: "A+",
  currentRating: 1.18,
  teamName: "Rival Orange",
  stats: null,
};

describe("PlayerDirectoryRow", () => {
  it("prioritizes season competition stats when they exist", () => {
    render(
      <PlayerDirectoryRow
        player={{
          ...player,
          stats: { maps: 8, hltvRating: 1.21, adr: 82.4, kd: 1.36, rivalhubRR: 1.15 },
        }}
      />,
    );

    expect(screen.getByText("Maps")).toBeInTheDocument();
    expect(screen.getByText("Secondary Closer")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("Rating 2.0")).toBeInTheDocument();
    expect(screen.getByText("1.21")).toBeInTheDocument();
    expect(screen.getByText("RR")).toBeInTheDocument();
    expect(screen.getByText("1.15")).toBeInTheDocument();
    expect(screen.getByText("82.4")).toBeInTheDocument();
    expect(screen.getByText("1.36")).toBeInTheDocument();
    expect(screen.queryByText("Rating Pro")).not.toBeInTheDocument();
  });

  it("keeps registration context when verified stats are missing", () => {
    render(<PlayerDirectoryRow player={player} />);

    expect(screen.getByText("No verified stats")).toBeInTheDocument();
    expect(screen.getByText("Peak Rank")).toBeInTheDocument();
    expect(screen.getByText("S")).toBeInTheDocument();
    expect(screen.getByText("Peak RT")).toBeInTheDocument();
    expect(screen.getByText("1.42")).toBeInTheDocument();
    expect(screen.getByText("Current Rank")).toBeInTheDocument();
    expect(screen.getByText("A+")).toBeInTheDocument();
  });
});

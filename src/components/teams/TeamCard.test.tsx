import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TeamCard } from "./TeamCard";

const props = {
  teamId: "team-1",
  teamName: "Rival Orange",
  seasonSlug: "spring",
  draftOrder: 2,
  logoUrl: null,
  players: [
    {
      name: "Captain Star",
      primaryPosition: "igl",
      isStarter: true,
      isCaptain: true,
      userId: "player-1",
    },
    {
      name: "Anchor Star",
      primaryPosition: "anchor",
      isStarter: true,
      isCaptain: false,
      userId: "player-2",
    },
  ],
};

describe("TeamCard", () => {
  it("renders record and verified summary stats", () => {
    render(
      <TeamCard
        {...props}
        record={{ played: 4, wins: 3, losses: 1, winRate: "75%" }}
        summary={{ maps: 12, avgRating: 1.14, avgAdr: 78.2 }}
      />,
    );

    expect(screen.getByText("3-1")).toBeInTheDocument();
    expect(screen.getByText("75% WR")).toBeInTheDocument();
    expect(screen.getByText("1.14")).toBeInTheDocument();
    expect(screen.getByText("78.2")).toBeInTheDocument();
  });
});

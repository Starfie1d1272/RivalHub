/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TeamCard } from "./TeamCard";

const props = {
  entryId: "entry-1",
  teamName: "Rival Orange",
  seasonSlug: "spring",
  eyebrow: "正式参赛队",
  logoUrl: null,
  players: [
    {
      name: "Captain Star",
      isStarter: true,
      isRepresentative: true,
      userId: "player-1",
    },
    {
      name: "Anchor Star",
      isStarter: true,
      isRepresentative: false,
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
    expect(screen.getByText("胜率 75%")).toBeInTheDocument();
    expect(screen.getByText("1.14")).toBeInTheDocument();
    expect(screen.getByText("78.2")).toBeInTheDocument();
  });

  it("uses event roster facts without rendering registration positions", () => {
    render(<TeamCard {...props} />);

    expect(screen.queryByText("代表人")).not.toBeInTheDocument();
    expect(screen.getAllByText("Captain Star")).not.toHaveLength(0);
    expect(screen.getByText("2 首发")).toBeInTheDocument();
    expect(screen.queryByText("igl")).not.toBeInTheDocument();
    expect(screen.queryByText("anchor")).not.toBeInTheDocument();
    expect(screen.queryByText("地图")).not.toBeInTheDocument();
  });
});

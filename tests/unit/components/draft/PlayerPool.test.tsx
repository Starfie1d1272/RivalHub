import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlayerPool } from "@/components/draft/PlayerPool";

describe("PlayerPool", () => {
  it("links remaining players to their profile pages", () => {
    render(
      <PlayerPool
        seasonPositions={["igl"]}
        players={[
          {
            registrationId: "reg-1",
            userId: "user-1",
            steamName: "Neo",
            primaryPosition: "igl",
            secondaryPosition: "anchor",
            peakRank: "S",
            peakRating: 2.01,
            mapPreferences: [],
          },
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: "Neo" })).toHaveAttribute(
      "href",
      "/players/user-1",
    );
  });
});

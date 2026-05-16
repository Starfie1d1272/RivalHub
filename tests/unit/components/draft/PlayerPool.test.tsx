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
            displayName: null,
            perfectName: null,
            email: "neo@example.com",
            steamName: "Neo",
            primaryPosition: "igl",
            secondaryPosition: "anchor",
            peakRank: "S",
            peakRating: 2.01,
            mapPreferences: [],
            gameplayStyle: null,
            notes: null,
            competitionHistory: null,
          },
        ]}
      />,
    );

    // 桌面端和移动端都会渲染链接，取第一个
    const [desktopLink] = screen.getAllByRole("link", { name: "Neo" });
    expect(desktopLink).toHaveAttribute("href", "/players/user-1");
  });
});

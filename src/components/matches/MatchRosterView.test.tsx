/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MatchRosterView } from "./MatchRosterView";

describe("MatchRosterView", () => {
  it("renders shared avatars for starters and substitutes", () => {
    render(
      <MatchRosterView
        teamAName="Alpha 队"
        teamBName="Beta 队"
        teamARoster={[
          { steamName: "Starter", displayName: null, perfectName: null, isStarter: true, userId: "user-1", avatarUrl: null },
          { steamName: "Sub", displayName: null, perfectName: null, isStarter: false, userId: "user-2", avatarUrl: null },
        ]}
        teamBRoster={[]}
      />,
    );

    expect(screen.getByRole("img", { name: "Starter" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Sub" })).toBeInTheDocument();
  });
});

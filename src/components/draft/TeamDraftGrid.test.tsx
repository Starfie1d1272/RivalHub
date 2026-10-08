/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TeamDraftGrid } from "./TeamDraftGrid";

describe("TeamDraftGrid", () => {
  it("links captains and drafted members to their player profiles", () => {
    render(
      <TeamDraftGrid
        currentEntryId="entry-1"
        currentRound={2}
        totalRounds={2}
        teams={[{
          entryId: "entry-1",
          teamName: "Alpha 队",
          draftOrder: 1,
          captain: { userId: "captain-user", personaName: "Captain", displayName: null, perfectName: null, avatarUrl: null, primaryPosition: "igl" },
          members: [{ userId: "member-user", personaName: "Neo", displayName: null, perfectName: null, avatarUrl: null, primaryPosition: "rifler", pickRound: 1, pickNumber: 1, autoPicked: false }],
        }]}
      />,
    );

    for (const name of ["Captain", "Neo"]) {
      for (const link of screen.getAllByRole("link", { name })) {
        expect(link).toHaveAttribute("href", name === "Captain" ? "/players/captain-user" : "/players/member-user");
      }
    }
  });
});

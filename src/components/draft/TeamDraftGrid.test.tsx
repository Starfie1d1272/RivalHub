/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TeamDraftGrid } from "./TeamDraftGrid";

describe("TeamDraftGrid", () => {
  it("renders shared avatars for captains and drafted members", () => {
    render(
      <TeamDraftGrid
        currentEntryId="entry-1"
        currentRound={2}
        totalRounds={2}
        teams={[{
          entryId: "entry-1",
          teamName: "Alpha 队",
          draftOrder: 1,
          captain: { steamName: "Captain", displayName: null, perfectName: null, avatarUrl: null, primaryPosition: "igl" },
          members: [{ steamName: "Neo", displayName: null, perfectName: null, avatarUrl: null, primaryPosition: "rifler", pickRound: 1, pickNumber: 1, autoPicked: false }],
        }]}
      />,
    );

    expect(screen.getAllByRole("img", { name: "Captain" })).toHaveLength(2);
    expect(screen.getAllByRole("img", { name: "Neo" })).toHaveLength(2);
  });
});

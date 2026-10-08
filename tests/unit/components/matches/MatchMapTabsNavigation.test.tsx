/**
 * @vitest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MatchMapTabsNavigation, type MatchMapTab } from "@/components/matches/MatchMapTabsNavigation";
import { Tabs } from "@/components/ui/tabs";

const bo5Maps: MatchMapTab[] = [
  { id: "map-1", mapName: "de_very-long-map-name-for-mobile-regression", pickedByEntryId: "team-a", scoreA: 13, scoreB: 9 },
  { id: "map-2", mapName: "de_ancient", pickedByEntryId: "team-b", scoreA: null, scoreB: null },
  { id: "map-3", mapName: "de_anubis", pickedByEntryId: null, scoreA: null, scoreB: null },
  { id: "map-4", mapName: "de_inferno", pickedByEntryId: "team-a", scoreA: null, scoreB: null },
  { id: "map-5", mapName: "de_nuke", pickedByEntryId: "team-b", scoreA: null, scoreB: null },
];

describe("MatchMapTabsNavigation", () => {
  it("selects a BO5 map while preserving score and pick facts", () => {
    render(
      <Tabs defaultValue="summary">
        <MatchMapTabsNavigation
          maps={bo5Maps}
          showSummaryTab
          teamAId="team-a"
          teamBId="team-b"
          teamAName="Alpha University Prime"
          teamBName="Beta University Prime"
        />
      </Tabs>,
    );



    expect(screen.getAllByRole("tab")).toHaveLength(6);
    expect(screen.getByRole("tab", { name: "整场汇总" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /very-long-map-name-for-mobile-regression/ })).toHaveTextContent("13:9");
    expect(screen.getByRole("tab", { name: /very-long-map-name-for-mobile-regression/ })).toHaveTextContent("PICK");
    expect(screen.getByRole("tab", { name: /Ancient/ })).toHaveTextContent("—");


    const finalMapTab = screen.getByRole("tab", { name: /Nuke/ });
    fireEvent.mouseDown(finalMapTab, { button: 0, ctrlKey: false });
    expect(finalMapTab).toHaveAttribute("aria-selected", "true");
  });
});

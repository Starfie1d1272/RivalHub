/**
 * @vitest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MatchMapTabsNavigation, type MatchMapTab } from "@/components/matches/MatchMapTabsNavigation";
import { Tabs } from "@/components/ui/tabs";

const bo5Maps: MatchMapTab[] = [
  { id: "map-1", mapName: "de_very-long-map-name-for-mobile-regression", pickedByEntryId: "team-a" },
  { id: "map-2", mapName: "de_ancient", pickedByEntryId: "team-b" },
  { id: "map-3", mapName: "de_anubis", pickedByEntryId: null },
  { id: "map-4", mapName: "de_inferno", pickedByEntryId: "team-a" },
  { id: "map-5", mapName: "de_nuke", pickedByEntryId: "team-b" },
];

describe("MatchMapTabsNavigation", () => {
  it("keeps a BO5 tab row locally scrollable with the selected state visible", () => {
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

    const tablist = screen.getByRole("tablist");
    expect(tablist.parentElement).toHaveClass("w-full", "min-w-0", "max-w-full", "overflow-x-auto");
    expect(tablist).toHaveClass("w-max", "justify-start");
    expect(screen.getAllByRole("tab")).toHaveLength(6);
    expect(screen.getByRole("tab", { name: "整场汇总" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /very-long-map-name-for-mobile-regression/ })).toHaveTextContent("ALP PICK");

    const finalMapTab = screen.getByRole("tab", { name: /Nuke/ });
    fireEvent.mouseDown(finalMapTab, { button: 0, ctrlKey: false });
    expect(finalMapTab).toHaveAttribute("aria-selected", "true");
    expect(finalMapTab).toHaveAttribute("data-state", "active");
  });
});

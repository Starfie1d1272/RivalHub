/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { OperatorIssuePanel } from "@/components/matches/OperatorIssuePanel";

it("identifies player differences by Steam nickname and profile, keeping numeric IDs out of visible copy", () => {
  const profile = "https://steamcommunity.com/profiles/76561198000000001";
  const { container } = render(<OperatorIssuePanel reasons={["lineup_mismatch"]} review={{
    expectedTeams: "星河大学 vs 东海理工", currentMap: "Map 1 · Ancient", officialScore: null,
    evidence: { at: "2026-10-03T10:00:00Z", mapBinding: "Map 1 · Ancient", mapName: "de_ancient", scoreA: null, scoreB: null,
      lineupDifference: {
        missing: [{ steam64: "76561198000000001", name: "星野 Steam", profileUrl: profile }],
        unexpected: [{ steam64: "76561198000000002", name: "待识别玩家", profileUrl: "https://steamcommunity.com/profiles/76561198000000002" }],
        duplicated: [],
      },
    },
  }} />);
  expect(screen.getByRole("link", { name: "星野 Steam" }).getAttribute("href")).toBe(profile);
  expect(screen.getByRole("link", { name: "待识别玩家" }).getAttribute("href")).toContain("76561198000000002");
  expect(container.textContent).not.toMatch(/7656119800000000[12]/);
});

/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomeSeasonPanel, shouldLoadRegistrationPositionCounts } from "@/components/home/HomeSeasonPanel";

const baseSeason = {
  name: "NJU Major 2026",
  slug: "nju-major-2026",
  status: "registration" as const,
  kind: "Major",
  positions: ["igl", "awper"],
  registrationOpensAt: new Date("2026-05-01T00:00:00.000Z"),
  registrationOpenedAt: new Date("2026-05-01T00:00:00.000Z"),
  registrationClosesAt: new Date("2099-06-01T00:00:00.000Z"),
};

const sharedProps = {
  maxPerPosition: 10,
  positionCountMap: new Map([["igl", 3], ["awper", 2]]),
  topCandidatesWithNames: [],
  liveAndUpcomingMatches: [],
  teamCount: 6,
  playerCount: 38,
};

describe("HomeSeasonPanel registration mode", () => {
  it("keeps solo position quotas and loads their counts", () => {
    const season = { ...baseSeason, registrationMode: "solo" as const };
    render(<HomeSeasonPanel {...sharedProps} season={season} />);

    expect(shouldLoadRegistrationPositionCounts(season)).toBe(true);
    expect(screen.getByText("igl")).toBeInTheDocument();
    expect(screen.getByText("3 / 10")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /立即报名/ })).not.toBeInTheDocument();
  });

  it("shows team participation stats without individual position quotas", () => {
    const season = { ...baseSeason, registrationMode: "team" as const };
    render(<HomeSeasonPanel {...sharedProps} season={season} />);

    expect(shouldLoadRegistrationPositionCounts(season)).toBe(false);
    expect(screen.queryByText("igl")).not.toBeInTheDocument();
    expect(screen.getByText("已通过审核")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("38")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /组队大厅/ })).toHaveAttribute("href", "/teams/recruitment");
  });
});

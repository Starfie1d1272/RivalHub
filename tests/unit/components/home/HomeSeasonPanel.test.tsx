/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomeSeasonPanel, shouldLoadRegistrationPositionCounts } from "@/components/home/HomeSeasonPanel";
import { HomeHero } from "@/components/home/HomeHero";
import { buildHomeEyebrow } from "@/lib/home/navigation";

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
  it("shows real qualification match links while the event still registers", () => {
    render(<HomeSeasonPanel {...sharedProps} season={{ ...baseSeason, registrationMode: "team" }} liveAndUpcomingMatches={[
      { id: "qualifier-1", status: "scheduled", scheduledAt: null, format: "bo3", teamAName: "Alpha", teamBName: "Beta" },
    ]} />);
    expect(screen.getByRole("link", { name: /Alpha.*Beta/ })).toHaveAttribute("href", `/${baseSeason.slug}/matches/qualifier-1`);
    expect(screen.getByRole("link", { name: /查看赛程/ })).toHaveAttribute("href", `/${baseSeason.slug}/matches`);
  });
  it("agrees with the homepage banner after registration has closed", () => {
    const season = { ...baseSeason, registrationMode: "team" as const, registrationOpensAt: new Date("2000-01-01"), registrationOpenedAt: new Date("2000-01-01"), registrationClosesAt: new Date("2000-02-01") };
    render(<><HomeHero season={season} eyebrow={buildHomeEyebrow(season)} /><HomeSeasonPanel {...sharedProps} season={season} /></>);
    expect(screen.getByText("● 报名已截止")).toBeVisible();
    expect(screen.getByText("报名已截止", { exact: true })).toBeVisible();
    expect(screen.queryByText(/报名开放|报名中/)).not.toBeInTheDocument();
  });

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

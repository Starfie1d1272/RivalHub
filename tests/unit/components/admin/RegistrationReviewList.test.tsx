/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RegistrationReviewList, type RegistrationRow } from "@/components/admin/RegistrationReviewList";

vi.mock("@/actions/admin", () => ({
  reviewRegistration: vi.fn(),
}));

const baseRow: RegistrationRow = {
  id: "reg-1",
  primaryPosition: "opener",
  secondaryPosition: "closer",
  peakRank: "A+",
  peakRankSeason: "S1 2026",
  peakRating: 1.5,
  currentSeasonPeakRank: "A",
  currentRating: 1.4,
  screenshotUrls: [],
  mapPreferences: [],
  gameplayStyle: "积极型",
  competitionHistory: null,
  notes: null,
  willingToBeCaptain: false,
  status: "pending",
  createdAt: "2026-09-01T00:00:00.000Z",
  email: "player1@example.com",
  studentId: "22000001",
  steamName: "player1_steam",
  displayName: "Player One",
  perfectName: "Perfect 1",
  steam64: "76561198000000001",
  steamProfileUrl: "https://steamcommunity.com/id/player1",
  qq: "12345678",
};

describe("RegistrationReviewList Steam link presentation", () => {
  it("renders clickable Steam profile link when steamProfileUrl is provided and safe", () => {
    render(<RegistrationReviewList registrations={[baseRow]} />);

    const link = screen.getByRole("link", { name: "Steam 主页" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "https://steamcommunity.com/id/player1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("does not render clickable Steam link when steamProfileUrl is null (e.g. invalid legacy URL)", () => {
    render(
      <RegistrationReviewList
        registrations={[
          {
            ...baseRow,
            steamProfileUrl: null,
          },
        ]}
      />,
    );

    expect(screen.queryByRole("link", { name: "Steam 主页" })).toBeNull();
    expect(screen.queryByText("Steam 主页")).toBeNull();
  });
});

/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RegistrationReviewList, type RegistrationRow } from "@/components/admin/RegistrationReviewList";

const { searchParamsMock } = vi.hoisted(() => ({
  searchParamsMock: { get: vi.fn(), toString: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/rivals-s1/registrations",
  useSearchParams: () => searchParamsMock,
}));

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

const baseProps: React.ComponentProps<typeof RegistrationReviewList> = {
  seasonSlug: "spring",
  positions: ["opener", "closer"],
  registrations: [baseRow],
  total: 1,
  page: 1,
  pageSize: 25,
  totalPages: 1,
  normalizedQuery: {
    q: undefined,
    status: "pending",
    position: undefined,
    sort: "oldest",
    page: 1,
    pageSize: 25,
  },
  hasAnyRecords: true,
};

function renderRegistrationList(overrides: Partial<React.ComponentProps<typeof RegistrationReviewList>> = {}) {
  return render(<RegistrationReviewList {...baseProps} {...overrides} />);
}

describe("RegistrationReviewList Steam link presentation", () => {
  beforeEach(() => {
    searchParamsMock.get.mockReturnValue(null);
    searchParamsMock.toString.mockReturnValue("");
  });

  it("renders clickable Steam profile link when steamProfileUrl is provided and safe", () => {
    renderRegistrationList();

    const link = screen.getByRole("link", { name: "Steam 主页" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "https://steamcommunity.com/id/player1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("does not render clickable Steam link when steamProfileUrl is null (e.g. invalid legacy URL)", () => {
    renderRegistrationList({
      registrations: [{ ...baseRow, steamProfileUrl: null }],
    });

    expect(screen.queryByRole("link", { name: "Steam 主页" })).toBeNull();
    expect(screen.queryByText("Steam 主页")).toBeNull();
  });

  it("labels newest registration sorting by submission time", () => {
    renderRegistrationList({
      normalizedQuery: { ...baseProps.normalizedQuery, sort: "newest" },
    });

    expect(screen.getByRole("option", { name: "最近提交" })).toHaveValue("newest");
    expect(screen.queryByRole("option", { name: "最近更新" })).toBeNull();
  });
});

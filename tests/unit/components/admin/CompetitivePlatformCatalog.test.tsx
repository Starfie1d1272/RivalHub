/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CompetitivePlatformCatalog } from "@/components/admin/CompetitivePlatformCatalog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/actions/competitive-platform", () => ({
  createCompetitivePlatform: vi.fn(), createCompetitivePlatformRank: vi.fn(), createCompetitivePlatformSeason: vi.fn(),
  deleteCompetitivePlatformRank: vi.fn(), deleteCompetitivePlatformSeason: vi.fn(), moveCompetitivePlatformRank: vi.fn(),
  moveCompetitivePlatformSeason: vi.fn(), setCurrentCompetitivePlatformSeason: vi.fn(), setCompetitivePlatformSeasonActive: vi.fn(),
  updateCompetitivePlatform: vi.fn(), updateCompetitivePlatformRankLabel: vi.fn(), updateCompetitivePlatformSeason: vi.fn(),
}));

describe("CompetitivePlatformCatalog", () => {
  it("shows the canonical Rating, chronology roles and low-to-high rank controls", async () => {
    const user = userEvent.setup();
    render(<CompetitivePlatformCatalog platforms={[{
      key: "perfect_world", displayName: "完美世界竞技平台", ratingLabel: "Rating Pro",
      ranks: [{ id: "rank-1", rankKey: "C+", label: "C+", sortOrder: 0 }],
      seasons: [
        { id: "s23", seasonKey: "S23", label: "S23", sortOrder: 1, active: true, isCurrent: false },
        { id: "s24", seasonKey: "S24", label: "S24", sortOrder: 2, active: true, isCurrent: true },
      ],
    }]} />);

    expect(screen.getByText("canonical performance Rating：Rating Pro")).toBeInTheDocument();
    expect(screen.getByText("当前赛季")).toBeInTheDocument();
    expect(screen.getByText("上一赛季")).toBeInTheDocument();
    expect(screen.getByText("段位顺序 · 由低到高")).toBeInTheDocument();
    expect(screen.getByTitle("上移（更低段位方向）")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "设为当前赛季" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("切换当前赛季")).toBeInTheDocument();
  });
});

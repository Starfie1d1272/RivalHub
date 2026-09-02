/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CompetitiveProfileForm } from "@/components/settings/CompetitiveProfileForm";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/actions/competitive-profile", () => ({ saveCompetitiveProfile: vi.fn() }));

beforeAll(() => Object.assign(window.HTMLElement.prototype, { scrollIntoView: () => {}, hasPointerCapture: () => false, releasePointerCapture: () => {} }));

const perfect = {
  platform: "perfect_world", platformDisplayName: "完美世界竞技平台", ratingLabel: "Rating Pro",
  ladder: [{ rankKey: "A", label: "A", starMin: null, starMax: null }],
  seasons: [
    { seasonKey: "2025s4", label: "2025S4", isCurrent: false, isPrevious: false },
    { seasonKey: "2026s1", label: "2026S1", isCurrent: false, isPrevious: true },
    { seasonKey: "2026s2", label: "2026S2", isCurrent: true, isPrevious: false },
  ],
  facts: [
    { kind: "historical_peak" as const, platformSeasonKey: null, status: "ranked" as const, rank: "A", rating: "2100", stars: null, achievedSeasonKey: "2025s4" },
    { kind: "season_peak" as const, platformSeasonKey: "2025s4", status: "unranked" as const, rank: null, rating: null, stars: null, achievedSeasonKey: null },
  ],
};

describe("CompetitiveProfileForm", () => {
  it("prioritizes Perfect World and explains the three distinct season states", () => {
    render(<CompetitiveProfileForm contexts={[{ ...perfect, platform: "fivee", platformDisplayName: "5E" }, perfect]} />);
    expect(screen.getByText(/完美世界竞技平台 · 长期竞技资料/)).toBeInTheDocument();
    expect(screen.getByText(/未录入表示尚未声明；未定级是有效事实/)).toBeInTheDocument();
    expect(screen.getByText("历史最高")).toBeInTheDocument();
    expect(screen.getByText(/历史赛季 · 2025S4/)).toBeInTheDocument();
    expect(screen.getAllByText("未定级").length).toBeGreaterThan(0);
  });

  it("keeps older catalog seasons compact until explicitly expanded", () => {
    render(<CompetitiveProfileForm contexts={[{ ...perfect, seasons: [{ seasonKey: "2025s3", label: "2025S3", isCurrent: false, isPrevious: false }, ...perfect.seasons] }]} />);
    expect(screen.getByRole("button", { name: /展开全部历史赛季/ })).toBeInTheDocument();
    expect(screen.getByText("历史赛季 · 2025S4")).toBeInTheDocument(); // maintained entries remain visible
    expect(screen.queryByText("历史赛季 · 2025S3")).toBeNull();
  });

  it("shows maintained older history as a compact summary until it is explicitly edited", async () => {
    const user = userEvent.setup();
    render(<CompetitiveProfileForm contexts={[perfect]} />);
    expect(screen.getByRole("button", { name: "编辑 历史赛季 · 2025S4" })).toBeInTheDocument();
    expect(screen.getAllByText("资料状态")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "编辑 历史赛季 · 2025S4" }));
    expect(screen.getAllByText("资料状态")).toHaveLength(3);
  });
});

/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CompetitiveProfileForm } from "@/components/settings/CompetitiveProfileForm";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/actions/competitive-profile", () => ({ saveCompetitiveProfile: vi.fn() }));

describe("CompetitiveProfileForm", () => {
  it("selects the first complete platform instead of locking the page on an incomplete one", () => {
    render(<CompetitiveProfileForm contexts={[
      { platform: "broken", platformDisplayName: "未完成平台", ratingLabel: "Rating", ladder: [], seasons: [], facts: [] },
      {
        platform: "five_e", platformDisplayName: "5E", ratingLabel: "Rating+",
        ladder: [{ rankKey: "C+", label: "C+" }],
        seasons: [
          { seasonKey: "S23", label: "S23", isCurrent: false, isPrevious: true },
          { seasonKey: "S24", label: "S24", isCurrent: true, isPrevious: false },
        ], facts: [],
      },
    ]} />);

    expect(screen.queryByText("当前竞技平台目录尚未完善")).not.toBeInTheDocument();
    expect(screen.getByText(/5E · 赛季资料/)).toBeInTheDocument();
    expect(screen.getByText(/Rating\+ 是该平台 canonical performance Rating/)).toBeInTheDocument();
  });
});

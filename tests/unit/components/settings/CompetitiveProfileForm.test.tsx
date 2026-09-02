/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CompetitiveProfileForm } from "@/components/settings/CompetitiveProfileForm";
import { saveCompetitiveProfile } from "@/actions/competitive-profile";
import { toast } from "sonner";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/actions/competitive-profile", () => ({ saveCompetitiveProfile: vi.fn() }));

// Radix Select 需要 jsdom 缺失的 pointer capture API 才能打开选项面板。
beforeAll(() => {
  Object.assign(window.HTMLElement.prototype, {
    scrollIntoView: () => {},
    hasPointerCapture: () => false,
    releasePointerCapture: () => {},
  });
});

describe("CompetitiveProfileForm", () => {
  it("defaults to the complete perfect_world context ahead of alphabetic catalog order", () => {
    render(<CompetitiveProfileForm contexts={[
      {
        platform: "fivee", platformDisplayName: "5E", ratingLabel: "Rating+",
        ladder: [{ rankKey: "S", label: "S", starMin: null, starMax: null }],
        seasons: [{ seasonKey: "S23", label: "S23", isCurrent: false, isPrevious: true }, { seasonKey: "S24", label: "S24", isCurrent: true, isPrevious: false }], facts: [],
      },
      {
        platform: "perfect_world", platformDisplayName: "完美世界竞技平台", ratingLabel: "Rating Pro",
        ladder: [{ rankKey: "A", label: "A", starMin: null, starMax: null }],
        seasons: [{ seasonKey: "2026s1", label: "2026S1", isCurrent: false, isPrevious: true }, { seasonKey: "2026s2", label: "2026S2", isCurrent: true, isPrevious: false }], facts: [],
      },
    ]} />);

    expect(screen.getByText(/完美世界竞技平台 · 赛季资料/)).toBeInTheDocument();
  });

  it("selects the first complete platform instead of locking the page on an incomplete one", () => {
    render(<CompetitiveProfileForm contexts={[
      { platform: "broken", platformDisplayName: "未完成平台", ratingLabel: "Rating", ladder: [], seasons: [], facts: [] },
      {
        platform: "five_e", platformDisplayName: "5E", ratingLabel: "Rating+",
        ladder: [{ rankKey: "C+", label: "C+", starMin: null, starMax: null }],
        seasons: [
          { seasonKey: "S23", label: "S23", isCurrent: false, isPrevious: true },
          { seasonKey: "S24", label: "S24", isCurrent: true, isPrevious: false },
        ], facts: [],
      },
    ]} />);

    expect(screen.queryByText("当前竞技平台目录尚未完善")).not.toBeInTheDocument();
    expect(screen.getByText(/5E · 赛季资料/)).toBeInTheDocument();
    expect(screen.getByText(/Rating\+ 是该平台官方竞技评分/)).toBeInTheDocument();
  });

  it("shows star input and the exact inclusive range only for star-enabled ranks, including legacy null stars", async () => {
    const user = userEvent.setup();
    vi.mocked(saveCompetitiveProfile).mockResolvedValue({ success: true, data: undefined });
    render(<CompetitiveProfileForm contexts={[{
      platform: "perfect_world", platformDisplayName: "完美世界竞技平台", ratingLabel: "Rating Pro",
      ladder: [
        { rankKey: "A++", label: "A++", starMin: null, starMax: null },
        { rankKey: "黄金S", label: "黄金S", starMin: 10, starMax: 24 },
      ],
      seasons: [
        { seasonKey: "2026s1", label: "2026S1", isCurrent: false, isPrevious: true },
        { seasonKey: "2026s2", label: "2026S2", isCurrent: true, isPrevious: false },
      ],
      facts: [{ kind: "historical_peak", platformSeasonKey: null, rank: "黄金S", rating: "2100", stars: null }],
    }]} />);

    expect(screen.getByPlaceholderText("星数待补充：10–24")).toBeInTheDocument();
    expect(screen.getByText(/历史资料未记录星数/)).toBeInTheDocument();
    expect(screen.getByLabelText("星数")).toHaveValue(null);
    const labelsInHistoricalField = () => Array.from(screen.getByText("历史最高").closest("section")?.querySelectorAll("label") ?? []).map((label) => label.textContent?.trim());
    expect(labelsInHistoricalField()).toEqual(["段位", "星数", "对应 Rating Pro"]);

    await user.click(screen.getAllByRole("combobox")[0]!);
    await user.click(screen.getByText("A++"));
    expect(screen.queryByLabelText("星数")).not.toBeInTheDocument();
    expect(labelsInHistoricalField()).toEqual(["段位", "对应 Rating Pro"]);
  });

  it("saves an untouched legacy null-stars fact unchanged, but blocks a real edit until stars are filled", async () => {
    const user = userEvent.setup();
    vi.mocked(saveCompetitiveProfile).mockResolvedValue({ success: true, data: undefined });
    render(<CompetitiveProfileForm contexts={[{
      platform: "perfect_world", platformDisplayName: "完美世界竞技平台", ratingLabel: "Rating Pro",
      ladder: [{ rankKey: "黄金S", label: "黄金S", starMin: 10, starMax: 24 }],
      seasons: [
        { seasonKey: "2026s1", label: "2026S1", isCurrent: false, isPrevious: true },
        { seasonKey: "2026s2", label: "2026S2", isCurrent: true, isPrevious: false },
      ],
      facts: [{ kind: "historical_peak", platformSeasonKey: null, rank: "黄金S", rating: "2100", stars: null }],
    }]} />);

    // Untouched legacy fact passes through with stars: null — no fabrication.
    await user.click(screen.getByRole("button", { name: "保存竞技档案" }));
    expect(saveCompetitiveProfile).toHaveBeenCalledWith(expect.objectContaining({
      historicalPeak: expect.objectContaining({ rank: "黄金S", rating: "2100", stars: null }),
    }));

    // Changing the Rating makes it a real edit; empty stars is blocked client-side.
    const ratingInput = screen.getAllByLabelText("对应 Rating Pro")[0]!;
    await user.clear(ratingInput);
    await user.type(ratingInput, "2200");
    await user.click(screen.getByRole("button", { name: "保存竞技档案" }));
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("历史最高需要填写段位、Rating"));
    expect(saveCompetitiveProfile).toHaveBeenCalledTimes(1);
  });

  it("clears incompatible stars when the rank changes and submits stars as an independent fact", async () => {
    const user = userEvent.setup();
    vi.mocked(saveCompetitiveProfile).mockResolvedValue({ success: true, data: undefined });
    render(<CompetitiveProfileForm contexts={[{
      platform: "fivee", platformDisplayName: "5E", ratingLabel: "Rating+",
      ladder: [
        { rankKey: "S", label: "S", starMin: 0, starMax: 19 },
        { rankKey: "SS", label: "SS", starMin: 20, starMax: 39 },
      ],
      seasons: [
        { seasonKey: "2026s3", label: "2026S3", isCurrent: false, isPrevious: true },
        { seasonKey: "2026s4", label: "2026S4", isCurrent: true, isPrevious: false },
      ],
      facts: [{ kind: "historical_peak", platformSeasonKey: null, rank: "S", rating: "1800", stars: 19 }],
    }]} />);

    await user.click(screen.getAllByRole("combobox")[0]!);
    await user.click(screen.getByText("SS"));
    expect(screen.getByLabelText("星数")).toHaveValue(null);
    await user.type(screen.getByLabelText("星数"), "26");
    await user.click(screen.getByRole("button", { name: "保存竞技档案" }));
    expect(saveCompetitiveProfile).toHaveBeenCalledWith(expect.objectContaining({
      platform: "fivee",
      historicalPeak: expect.objectContaining({ rank: "SS", stars: 26, rating: "1800" }),
    }));
  });
});

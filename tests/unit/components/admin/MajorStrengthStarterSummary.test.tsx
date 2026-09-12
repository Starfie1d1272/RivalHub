/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MajorStrengthStarterSummary } from "@/components/admin/MajorStrengthStarterSummary";

Object.assign(globalThis, { React });

describe("MajorStrengthStarterSummary", () => {
  it("keeps historical, reference, and recent evidence distinct while retaining useful diagnostics", () => {
    render(<MajorStrengthStarterSummary
      platform="perfect_world"
      starter={{
        userId: "player-1",
        label: "不争",
        presentation: {
          historicalPeak: { rank: "黄金S", stars: 10, sourcePlatform: "fivee", sourceSeasonKey: "5e-s20", sourceRank: "S", sourceStars: 10, conversionVersion: "v1" },
          referenceSeasonPeak: null,
          currentSeasonPeak: { rank: "钻石S", stars: 2, sourcePlatform: null, sourceSeasonKey: null, sourceRank: null, sourceStars: null, conversionVersion: null },
          recentPeak: { rank: "A++", stars: null, sourcePlatform: null, sourceSeasonKey: null, sourceRank: null, sourceStars: null, conversionVersion: null },
          historicalRating: 1000,
          available: true,
          blockers: [],
        },
      }}
    />);

    expect(screen.getByText("历史 黄金S · 10 星")).toBeVisible();
    expect(screen.getByText("参考 暂无")).toBeVisible();
    expect(screen.getByText("近期 A++")).toBeVisible();
    expect(screen.getByText("当前赛季候选：钻石S · 2 星")).toBeInTheDocument();
    expect(screen.getByText("历史 Rating 1000")).toBeInTheDocument();
    expect(screen.queryByText(/综合|历史\/前一赛季\/近期参考/)).not.toBeInTheDocument();
    const badge = screen.getAllByText("采用 5E 等效")[0];
    expect(badge).toHaveClass("inline-flex", "whitespace-nowrap", "shrink-0");
  });
});

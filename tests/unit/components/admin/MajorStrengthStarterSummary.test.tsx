/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MajorStrengthStarterSummary } from "@/components/admin/MajorStrengthStarterSummary";

Object.assign(globalThis, { React });

describe("MajorStrengthStarterSummary", () => {
  it("keeps historical, composite, and recent evidence distinct before expansion", () => {
    render(<MajorStrengthStarterSummary
      platform="perfect_world"
      starter={{
        userId: "player-1",
        label: "不争",
        historicalPeak: { rank: "黄金S", stars: 10, sourcePlatform: "fivee", sourceSeasonKey: "5e-s20", sourceRank: "S", sourceStars: 10, conversionVersion: "v1" },
        previousSeasonPeak: null,
        currentSeasonPeak: null,
        recentSeasonPeaks: [],
        effectiveRecentPeak: { rank: "A++", stars: null, sourcePlatform: null, sourceSeasonKey: null, sourceRank: null, sourceStars: null, conversionVersion: null },
        breakdown: { available: true, blockers: [], weightedRank: 11.4, historicalValue: 12, previousValue: 10, currentValue: 11, effectiveRecentPeak: null, historicalRating: null },
      }}
    />);

    expect(screen.getByText("历史 黄金S · 10 星")).toBeVisible();
    expect(screen.getByText("综合 11.40")).toBeVisible();
    expect(screen.getByText("近期 A++")).toBeVisible();
    const badge = screen.getAllByText("采用 5E 等效")[0];
    expect(badge).toHaveClass("inline-flex", "whitespace-nowrap", "shrink-0");
  });
});

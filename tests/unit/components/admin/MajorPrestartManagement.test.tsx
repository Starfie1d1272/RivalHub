/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MajorPrestartManagement } from "@/components/admin/MajorPrestartManagement";
import type { MajorPrestartManagementData } from "@/components/admin/MajorPrestartManagement";

Object.assign(globalThis, { React });

vi.mock("@/actions/major-prestart", () => ({
  addMajorPrestartIssue: vi.fn(),
  lockMajorPrestartEntrants: vi.fn(),
  resolveMajorPrestartIssue: vi.fn(),
  selectMajorEntrants: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("MajorPrestartManagement", () => {
  it("uses operator language without exposing roster implementation details", () => {
    render(<MajorPrestartManagement data={{
      seasonId: "season-1",
      entrantCapacity: 32,
      entrantsLocked: false,
      strengthPreview: { status: "ready", platform: "perfect_world", conversionPolicyId: null, conversionPolicyVersion: null, blockers: [], teams: [] },
      approvedCandidates: [{
        id: "team-1",
        name: "Team One",
        representativeName: "负责人",
        submittedAt: null,
        reviewedAt: null,
        approvedAt: null,
        qualificationStatus: "approved",
        selectedAsEntrant: false,
        roster: { memberCount: 5, primaryStarterCount: 5, members: [] },
      }],
      entrants: [{
        id: "entrant-1",
        teamId: "team-1",
        teamName: "Team One",
        rosterStatus: "confirmed",
        roster: [{ userId: "user-1", email: "player@example.com", isPrimaryStarter: true, educationVerified: true }],
      }],
      issues: [],
    }} />);

    expect(screen.getByText("报名已通过 · 候选")).toBeVisible();
    expect(screen.getByText("已审核报名名单：5 人 · 5 名主力")).toBeVisible();
    expect(screen.getByText("学籍资料已确认", { exact: false })).toBeVisible();
    expect(screen.queryByText(/EventRoster|approved roster|revision|materialize/)).not.toBeInTheDocument();
  });

  it("shows the live read-only strength reference and keeps incomplete teams out of ranking", () => {
    const data: MajorPrestartManagementData = {
      seasonId: "season-1",
      entrantCapacity: 32,
      entrantsLocked: false,
      strengthPreview: {
        status: "ready",
        platform: "perfect_world",
        conversionPolicyId: null,
        conversionPolicyVersion: null,
        blockers: [],
        teams: [
          {
            teamId: "team-strong",
            teamName: "Strong Team",
            available: true,
            blockers: [],
            teamSeedStrength: 12.34,
            teamSeedStrengthScaled: 1234,
            recommendationRank: 1,
            tieGroup: 1,
            displayOrder: 1,
            starters: [{
              userId: "user-strong",
              label: "Strong Player",
              historicalPeak: { rank: "A", stars: null, sourcePlatform: null, sourceSeasonKey: null, sourceRank: null, sourceStars: null, conversionVersion: null },
              previousSeasonPeak: { rank: "A", stars: null, sourcePlatform: null, sourceSeasonKey: null, sourceRank: null, sourceStars: null, conversionVersion: null },
              currentSeasonPeak: { rank: "A", stars: null, sourcePlatform: null, sourceSeasonKey: null, sourceRank: null, sourceStars: null, conversionVersion: null },
              recentSeasonPeaks: [],
              effectiveRecentPeak: null,
              breakdown: { available: true, blockers: [], weightedRank: 12.34, historicalValue: 12, previousValue: 12, currentValue: 13, effectiveRecentPeak: null, historicalRating: 1000 },
            }],
          },
          {
            teamId: "team-blocked",
            teamName: "Blocked Team",
            available: false,
            blockers: ["缺少当前赛季最高段位及 Rating。"],
            teamSeedStrength: null,
            teamSeedStrengthScaled: null,
            recommendationRank: null,
            tieGroup: null,
            displayOrder: null,
            starters: [],
          },
        ],
      },
      approvedCandidates: [],
      entrants: [],
      issues: [],
    };

    render(<MajorPrestartManagement data={data} />);

    expect(screen.getByRole("heading", { name: "实时队伍实力参考" })).toBeVisible();
    expect(screen.getByText("#1 · Strong Team")).toBeVisible();
    expect(screen.getByText("Strong Player")).toBeVisible();
    expect(screen.getByText("无法计算，不按 0 参与排序")).toBeVisible();
    expect(screen.getByText("缺少当前赛季最高段位及 Rating。", { exact: false })).toBeVisible();
    expect(screen.getByText("不自动选择正式参赛队，不改变资格结论")).toBeVisible();
  });
});

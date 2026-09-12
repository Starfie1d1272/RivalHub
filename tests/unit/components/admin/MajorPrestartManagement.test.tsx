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
        roster: [{ userId: "user-1", label: "Player One", isPrimaryStarter: true, educationVerified: true }],
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
            recommendationRank: 1,
            tieState: "not_tied",
            starters: [{
              userId: "user-strong",
              label: "Strong Player",
              presentation: { historicalPeak: { rank: "A", stars: null, sourcePlatform: null, sourceSeasonKey: null, sourceRank: null, sourceStars: null, conversionVersion: null }, referenceSeasonPeak: { rank: "A", stars: null, sourcePlatform: null, sourceSeasonKey: null, sourceRank: null, sourceStars: null, conversionVersion: null }, recentPeak: { rank: "A", stars: null, sourcePlatform: null, sourceSeasonKey: null, sourceRank: null, sourceStars: null, conversionVersion: null }, available: true, blockers: [] },
            }],
          },
          {
            teamId: "team-blocked",
            teamName: "Blocked Team",
            available: false,
            blockers: ["缺少当前赛季最高段位及 Rating。"],
            recommendationRank: null,
            tieState: "not_ranked",
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
    expect(screen.getByText("系统参考顺序")).toBeVisible();
    expect(screen.getByText("Strong Player")).toBeVisible();
    expect(screen.queryByText("12.34")).not.toBeInTheDocument();
    expect(screen.queryByText(/并列组/)).not.toBeInTheDocument();
    expect(screen.getByText("无法计算，不按 0 参与排序")).toBeVisible();
    expect(screen.getByText("缺少当前赛季最高段位及 Rating。", { exact: false })).toBeVisible();
    expect(screen.getByText("不自动选择正式参赛队，不改变资格结论")).toBeVisible();
  });
});

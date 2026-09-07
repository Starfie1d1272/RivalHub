/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MajorPrestartManagement } from "@/components/admin/MajorPrestartManagement";

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
});

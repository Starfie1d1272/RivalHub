/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MajorLiveRanking, MajorPrestartManagement, type MajorPrestartManagementData } from "@/components/admin/MajorPrestartManagement";

Object.assign(globalThis, { React });
vi.mock("@/actions/major-prestart", () => ({ lockMajorPrestartEntrants: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const fact = { rank: "A", stars: null, sourcePlatform: null, sourceSeasonKey: null, sourceRank: null, sourceStars: null, conversionVersion: null };
const member = (userId: string, isPrimaryStarter: boolean) => ({
  userId, label: userId, isPrimaryStarter,
  presentation: { currentSeasonPeak: fact, recentPeak: fact, referenceSeasonPeak: fact, historicalPeak: fact, historicalRating: null, available: true, blockers: [] },
});
function data(overrides: Partial<MajorPrestartManagementData> = {}): MajorPrestartManagementData {
  return {
    seasonId: "season-1", seasonSlug: "major", seasonStatus: "registration", managedProfileId: "major-32",
    registrationClosesAt: null, registrationOpenState: "open", rosterChangeClosesAt: null, rosterAdjustmentDeadlinePassed: true, mainEventPlannedStartAt: null, mainEventStartOverdue: false, registrationClosed: false,
    entrantCapacity: 32, entrantsLocked: false, approvedCandidateCount: 1, pendingReviewCount: 0,
    initialPreliminaryOrderEntryIds: ["team-1"], rankingRoster: [{ entryId: "team-1", members: [member("starter", true), member("substitute", false)] }],
    strengthPreview: { status: "ready", platform: "perfect_world", conversionPolicyId: null, conversionPolicyVersion: null, blockers: [], teams: [{ teamId: "team-1", teamName: "Team One", available: true, blockers: [], recommendationRank: 1, displayOrder: 1, tieState: "not_tied", starters: [] }] },
    approvedCandidates: [{ id: "team-1", name: "Team One", representativeName: "Captain", submittedAt: null, reviewedAt: null, approvedAt: null, qualificationStatus: "approved", selectedAsEntrant: false, roster: { memberCount: 2, primaryStarterCount: 1, members: [] } }],
    entrants: [], qualification: { run: null }, ...overrides,
  };
}

describe("Major roster presentation", () => {
  it("shows the complete roster and fixed current/recent/previous/history fields in one row", () => {
    render(<MajorLiveRanking data={data()} />);
    expect(screen.getByRole("row", { name: /Team One/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "starter" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "substitute" })).toBeInTheDocument();
    expect(screen.getAllByText("今")).toHaveLength(2);
    expect(screen.getAllByText("近")).toHaveLength(2);
    expect(screen.getAllByText("前")).toHaveLength(2);
    expect(screen.getAllByText("史")).toHaveLength(2);
    expect(screen.queryByText(/weightedRank|teamSeedStrength/)).not.toBeInTheDocument();
  });
  it("keeps final lock unavailable while entrants are incomplete", () => {
    render(<MajorPrestartManagement data={data()} />);
    expect(screen.getByRole("button", { name: "冻结正式名单" })).toBeDisabled();
  });
});

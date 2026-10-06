/** @vitest-environment jsdom */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MajorPrestartConsole } from "@/components/admin/MajorPrestartConsole";
import type { MajorPrestartManagementData } from "@/components/admin/MajorPrestartManagement";
import type { MajorTournamentSeedsManagementData } from "@/components/admin/MajorTournamentSeedsManagement";
import type { MajorPrestartReadiness } from "@/lib/major/prestart";

Object.assign(globalThis, { React });
vi.mock("@/components/admin/MajorPrestartManagement", () => ({ MajorLiveRanking: () => <div>LIVE MATRIX</div>, MajorPrestartManagement: () => <div>FINAL ROSTER</div> }));
vi.mock("@/components/admin/MajorCompetitionFlow", () => ({ MajorCompetitionFlow: ({ phase }: { phase: string }) => <div>FLOW {phase}</div> }));
vi.mock("@/components/admin/MajorTournamentSeedsManagement", () => ({ MajorTournamentSeedsManagement: () => <div>FINAL MATRIX</div> }));
vi.mock("@/components/admin/MajorStartManagement", () => ({ MajorStartManagement: () => <div>START ACTION</div> }));
vi.mock("@/components/admin/MajorPrestartScheduleEditor", () => ({ MajorPrestartScheduleEditor: () => <div>SCHEDULE</div> }));

const readiness: MajorPrestartReadiness = { canStart: false, blockers: [], checks: [], openingPlan: null };
const management: MajorPrestartManagementData = {
  seasonId: "season-1", seasonSlug: "major", seasonStatus: "registration", managedProfileId: "major-32",
  registrationClosesAt: null, registrationOpenState: "open", rosterChangeClosesAt: null, rosterAdjustmentDeadlinePassed: true, mainEventPlannedStartAt: null, mainEventStartOverdue: false, registrationClosed: false,
  entrantCapacity: 32, entrantsLocked: false, approvedCandidateCount: 0, pendingReviewCount: 0,
  initialPreliminaryOrderEntryIds: [], rankingRoster: [],
  strengthPreview: { status: "ready", platform: "perfect_world", conversionPolicyId: null, conversionPolicyVersion: null, blockers: [], teams: [] },
  approvedCandidates: [], entrants: [], qualification: { run: null, draft: null },
};
const seeds: MajorTournamentSeedsManagementData = {
  seasonId: "season-1", entrantCapacity: 32, firstSwissStageName: "阶段一", entryCohorts: [],
  entrantsLocked: false, entrants: [], seeds: [], seedsConfirmed: false,
  recommendationStatus: "missing", recommendation: null, firstRound: null,
};

function markup(current: MajorPrestartManagementData, seedState = seeds, started = false) {
  return renderToStaticMarkup(<MajorPrestartConsole seasonName="Major" readiness={readiness} management={current} seedManagement={seedState} started={started} />);
}

function scheduleCount(html: string) {
  return html.split("SCHEDULE").length - 1;
}

describe("MajorPrestartConsole", () => {
  it("shows only the current registration workspace with a six-phase stepper", () => {
    const html = markup(management);
    expect(html).toContain("报名收口");
    expect(html).toContain("开赛确认");
    expect(html).toContain("LIVE MATRIX");
    expect(html).not.toContain("FINAL MATRIX");
    expect(html).not.toContain("START ACTION");
    expect(scheduleCount(html)).toBe(1);
  });
  it("folds completed phases and opens the final seed workspace after roster lock", () => {
    const html = markup({ ...management, registrationClosed: true, approvedCandidateCount: 32, entrantsLocked: true }, { ...seeds, seedsConfirmed: false });
    expect(html).toContain("FINAL MATRIX");
    expect(html).toContain("<details");
    expect(html).not.toContain("LIVE MATRIX");
    expect(html).not.toContain("START ACTION");
    expect(scheduleCount(html)).toBe(0);
  });
  it("exposes operational schedule controls only in the phase that owns them", () => {
    const finalRoster = markup({
      ...management,
      registrationClosed: true,
      approvedCandidateCount: 32,
      entrants: [{ id: "entrant-1", teamId: "entry-1", teamName: "Team One", rosterStatus: "confirmed", roster: [], recentRosterChange: null }],
    });
    expect(finalRoster).toContain("FINAL ROSTER");
    expect(scheduleCount(finalRoster)).toBe(1);

    const start = markup(
      { ...management, registrationClosed: true, approvedCandidateCount: 32, entrantsLocked: true },
      { ...seeds, seedsConfirmed: true },
    );
    expect(start).toContain("START ACTION");
    expect(scheduleCount(start)).toBe(1);
  });
});

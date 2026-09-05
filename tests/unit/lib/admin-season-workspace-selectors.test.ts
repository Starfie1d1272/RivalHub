import { describe, expect, it } from "vitest";
import { projectRegistrationSummary, selectSeasonWorkspaceNextAction } from "@/lib/admin/season-workspace/selectors";
import type { SeasonWorkspaceOverviewSummary } from "@/lib/admin/season-workspace/types";

const baseSummary: SeasonWorkspaceOverviewSummary = {
  pendingApplications: 0,
  approvedEntries: 0,
  formedTeamCount: 0,
  entrantCount: 0,
  frozenEntrantCount: 0,
  matchCount: 0,
  unresolvedPrestartIssues: 0,
  scheduledMatchesWithoutConfirmedLineups: 0,
  finalResultPendingConfirmation: false,
  activeAdjudications: 0,
};

describe("season workspace selectors", () => {
  it("projects solo registrations separately from team entries", () => {
    expect(projectRegistrationSummary("solo", [
      { status: "pending", count: 8 },
      { status: "approved", count: 24 },
    ], 4)).toEqual({ pendingApplications: 8, approvedEntries: 24, formedTeamCount: 4 });

    expect(projectRegistrationSummary("team", [
      { status: "submitted", count: 3 },
      { status: "approved", count: 12 },
    ], 0)).toEqual({ pendingApplications: 3, approvedEntries: 12, formedTeamCount: 12 });
  });

  it("prioritizes lifecycle before residual counts", () => {
    const finishedWithMatches = selectSeasonWorkspaceNextAction(
      { slug: "finished-event", status: "finished", registrationOpenedAt: new Date() },
      { ...baseSummary, matchCount: 47, pendingApplications: 2 },
      null,
    );
    expect(finishedWithMatches.href).toBe("/admin/finished-event/post-event");

    const archived = selectSeasonWorkspaceNextAction(
      { slug: "archived-event", status: "archived", registrationOpenedAt: new Date() },
      { ...baseSummary, matchCount: 32 },
      null,
    );
    expect(archived.href).toBe("/admin/archived-event/post-event");
    expect(archived.detail).toContain("只读");

    const playingWithMatches = selectSeasonWorkspaceNextAction(
      { slug: "live-event", status: "playing", registrationOpenedAt: new Date() },
      { ...baseSummary, matchCount: 12 },
      null,
    );
    expect(playingWithMatches.href).toBe("/admin/live-event/matches");

    const registrationWithPending = selectSeasonWorkspaceNextAction(
      { slug: "registration-event", status: "registration", registrationOpenedAt: new Date() },
      { ...baseSummary, pendingApplications: 1 },
      null,
    );
    expect(registrationWithPending.href).toBe("/admin/registration-event/registrations");

    const preopen = selectSeasonWorkspaceNextAction(
      { slug: "preopen-event", status: "registration", registrationOpenedAt: null },
      baseSummary,
      null,
    );
    expect(preopen.href).toBe("/admin/preopen-event/registrations");

    const registrationWithBlocker = selectSeasonWorkspaceNextAction(
      { slug: "blocked-event", status: "registration", registrationOpenedAt: new Date() },
      baseSummary,
      { canStart: false, blockers: ["名单仍待确认。"], checks: [{ key: "teams", label: "队伍", state: "blocked", blockers: ["名单仍待确认。"] }], openingPlan: null },
    );
    expect(registrationWithBlocker.href).toBe("/admin/blocked-event/prestart");
  });
});

import { describe, expect, it } from "vitest";
import { canMutateCompetitionEntryRoster } from "@/lib/competition-entries/remediation";

const openSeason = {
  status: "registration" as const,
  registrationOpensAt: new Date("2026-09-01T00:00:00Z"),
  registrationOpenedAt: new Date("2026-09-01T00:00:00Z"),
  registrationClosesAt: new Date("2026-09-10T00:00:00Z"),
  rosterChangeClosesAt: new Date("2026-09-20T00:00:00Z"),
};

describe("CompetitionEntry deadline remediation", () => {
  it("keeps normal draft editing closed after the registration deadline", () => {
    expect(canMutateCompetitionEntryRoster("draft", "initial", openSeason, new Date("2026-09-11T00:00:00Z"))).toBe(false);
  });

  it("allows admin remediation after the deadline but closes self roster changes at their own deadline", () => {
    const afterRosterDeadline = new Date("2026-09-21T00:00:00Z");
    expect(canMutateCompetitionEntryRoster("changes_requested", "admin_remediation", openSeason, afterRosterDeadline)).toBe(true);
    expect(canMutateCompetitionEntryRoster("changes_requested", "self_roster_change", openSeason, afterRosterDeadline)).toBe(false);
  });

  it("keeps a self roster change editable only through the roster-change deadline", () => {
    expect(canMutateCompetitionEntryRoster("changes_requested", "self_roster_change", openSeason, new Date("2026-09-15T00:00:00Z"))).toBe(true);
  });
});

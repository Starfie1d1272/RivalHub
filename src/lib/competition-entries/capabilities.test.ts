import { describe, expect, it } from "vitest";
import { getCompetitionEntryCapabilities } from "./capabilities";
import { canMutateCompetitionEntryRoster } from "./remediation";
import { canSelfChangeApprovedRoster } from "@/lib/registration/window";

const season = {
  status: "registration" as const,
  registrationOpensAt: new Date("2026-09-01"), registrationOpenedAt: new Date("2026-09-01"),
  registrationClosesAt: new Date("2026-09-10"), rosterChangeClosesAt: new Date("2026-09-20"),
};
const now = new Date("2026-09-15");

describe("registration action capabilities", () => {
  it.each(["2026-08-31", "2026-09-10"])("cannot start outside the registration window: %s", (date) => {
    expect(getCompetitionEntryCapabilities({ season, entry: null, revision: null, rosterFrozen: false }, new Date(date)).canStartRegistration).toBe(false);
  });
  it.each(["draft", "changes_requested"] as const)("matches mutation deadline policy for %s", (status) => {
    for (const origin of ["initial", "admin_remediation", "self_roster_change"] as const) {
      const result = getCompetitionEntryCapabilities({ season, entry: { status, hasApprovedRoster: false }, revision: { status: "draft", origin }, rosterFrozen: false }, now);
      expect(result.canEditCurrentRoster).toBe(canMutateCompetitionEntryRoster(status, origin, season, now));
      expect(result.canSubmitForReview).toBe(result.canEditCurrentRoster);
    }
  });
  it("keeps administrator remediation available after both deadlines", () => {
    const result = getCompetitionEntryCapabilities({ season, entry: { status: "changes_requested", hasApprovedRoster: true }, revision: { status: "draft", origin: "admin_remediation" }, rosterFrozen: false }, new Date("2026-10-01"));
    expect(result.canRespondToAdminRemediation).toBe(true);
    expect(result.readOnlyReason).toBeNull();
  });
  it("only allows approved roster changes within their window and before freeze", () => {
    const input = { season, entry: { status: "approved" as const, hasApprovedRoster: true }, revision: { status: "approved", origin: "initial" as const }, rosterFrozen: false };
    expect(getCompetitionEntryCapabilities(input, now).canRequestRosterChange).toBe(canSelfChangeApprovedRoster(season, now));
    expect(getCompetitionEntryCapabilities(input, new Date("2026-09-20"))).toMatchObject({ canRequestRosterChange: false, readOnlyReason: "名单调整已截止" });
    expect(getCompetitionEntryCapabilities({ ...input, rosterFrozen: true }, now)).toMatchObject({ canRequestRosterChange: false, canEditCurrentRoster: false, readOnlyReason: "最终名单已锁定" });
    expect(getCompetitionEntryCapabilities({ ...input, season: { ...season, rosterChangeClosesAt: null } }, now).canRequestRosterChange).toBe(false);
  });
  it.each(["submitted", "waitlisted", "rejected", "withdrawn"] as const)("does not expose edit or submit for %s", (status) => {
    expect(getCompetitionEntryCapabilities({ season, entry: { status, hasApprovedRoster: false }, revision: { status: "submitted", origin: "initial" }, rosterFrozen: false }, new Date("2026-09-05"))).toMatchObject({ canEditCurrentRoster: false, canSubmitForReview: false, canRequestRosterChange: false, canWithdrawFromReview: status === "submitted" });
  });
  it("does not allow review withdrawal after the roster is frozen", () => {
    expect(getCompetitionEntryCapabilities({ season, entry: { status: "submitted", hasApprovedRoster: false }, revision: { status: "submitted", origin: "initial" }, rosterFrozen: true }).canWithdrawFromReview).toBe(false);
  });
  it("only allows review withdrawal before the registration deadline", () => {
    const input = { season, entry: { status: "submitted" as const, hasApprovedRoster: false }, revision: { status: "submitted", origin: "initial" as const }, rosterFrozen: false };
    expect(getCompetitionEntryCapabilities(input, new Date("2026-09-09T23:59:59.999Z")).canWithdrawFromReview).toBe(true);
    expect(getCompetitionEntryCapabilities(input, new Date("2026-09-10T00:00:00.000Z")).canWithdrawFromReview).toBe(false);
    expect(getCompetitionEntryCapabilities(input, new Date("2026-09-11T00:00:00.000Z")).canWithdrawFromReview).toBe(false);
  });
});

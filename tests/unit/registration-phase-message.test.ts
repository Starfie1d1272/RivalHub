import { expect, it } from "vitest";
import { getCompetitionEntryCapabilities } from "@/lib/competition-entries/capabilities";

it("distinguishes phase restrictions from an expired deadline without opening roster actions", () => {
  const now = new Date("2026-10-18T00:00:00Z");
  const input = {
    season: { status: "registration" as const, registrationOpensAt: "2026-09-01", registrationOpenedAt: "2026-09-01", registrationClosesAt: "2026-09-26", rosterChangeClosesAt: "2026-10-22" },
    entry: { status: "approved" as const, hasApprovedRoster: true },
    revision: { status: "approved", origin: "initial" as const },
    rosterFrozen: false,
    majorAdjustmentPhaseOpen: false,
  };
  const restricted = getCompetitionEntryCapabilities(input, now);
  expect(restricted.readOnlyReason).toContain("当前赛事阶段");
  expect(restricted.canRequestRosterChange).toBe(false);
  expect(restricted.canConfirmParticipation).toBe(false);
  expect(getCompetitionEntryCapabilities({ ...input, majorAdjustmentPhaseOpen: true }, now).canRequestRosterChange).toBe(true);
  expect(getCompetitionEntryCapabilities(input, new Date("2026-10-23")).readOnlyReason).toContain("已截止");
  expect(getCompetitionEntryCapabilities({ ...input, rosterFrozen: true }, now).readOnlyReason).toContain("已锁定");
});

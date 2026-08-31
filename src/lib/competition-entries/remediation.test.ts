import { describe, expect, it } from "vitest";
import { canEditCompetitionEntryRoster } from "@/lib/competition-entries/remediation";

describe("CompetitionEntry deadline remediation", () => {
  it("keeps normal draft editing closed after the deadline", () => {
    expect(canEditCompetitionEntryRoster("draft", false)).toBe(false);
  });

  it("allows only changes_requested remediation after the deadline", () => {
    expect(canEditCompetitionEntryRoster("changes_requested", false)).toBe(true);
  });
});

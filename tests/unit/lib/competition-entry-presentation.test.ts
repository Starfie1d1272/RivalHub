import { describe, expect, it } from "vitest";
import { presentCompetitionEntryRegistration } from "@/lib/competition-entries/presentation";

describe("competition entry registration presentation", () => {
  it("distinguishes a self-service roster change from an administrator correction", () => {
    expect(presentCompetitionEntryRegistration("changes_requested", "self_roster_change")).toMatchObject({
      label: "名单变更中",
      state: "incomplete",
      detail: expect.stringContaining("重新提交审核"),
    });
    expect(presentCompetitionEntryRegistration("changes_requested", "admin_remediation")).toMatchObject({
      label: "需补正",
      state: "blocked",
    });
  });
});

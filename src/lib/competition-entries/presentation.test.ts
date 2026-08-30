import { describe, expect, it } from "vitest";
import {
  presentCompetitionEntryParticipation,
  presentCompetitionEntryRegistration,
} from "@/lib/competition-entries/presentation";

describe("CompetitionEntry presentation", () => {
  it.each([
    ["draft", "草稿", "incomplete"],
    ["submitted", "已提交", "waiting"],
    ["changes_requested", "需补正", "blocked"],
    ["waitlisted", "候补", "waiting"],
    ["approved", "已批准", "ready"],
  ] as const)("maps registration %s to its shared label and state", (status, label, state) => {
    expect(presentCompetitionEntryRegistration(status)).toMatchObject({ label, state });
  });

  it("marks invited members in a changes_requested revision as needing reconfirmation", () => {
    expect(presentCompetitionEntryParticipation("invited", "changes_requested")).toMatchObject({
      label: "需要重新确认",
      state: "waiting",
    });
    expect(presentCompetitionEntryParticipation("invited", "submitted")).toMatchObject({
      label: "被邀请待确认",
      state: "waiting",
    });
  });
});

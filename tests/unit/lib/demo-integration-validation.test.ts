import { describe, expect, it } from "vitest";
import { hasConfirmableParticipantIdentityIssue } from "@/lib/demo-integration/validation";

describe("Demo participant identity issue projection", () => {
  it("only projects the exact unresolved participant path as confirmable", () => {
    const participantA = "76561198000000001";
    const participantB = "76561198000000002";

    const issues = [
      {
        code: "PARTICIPANT_IDENTITY_UNRESOLVED",
        path: `participants.${participantA}`,
        message: "选手身份未能以 Steam64 唯一匹配，不能自动接收。",
      },
      {
        code: "PARTICIPANT_NOT_IN_ROSTER",
        path: `participants.${participantB}`,
        message: "Demo Steam64 不属于本场已确认首发名单。",
      },
    ];

    expect(hasConfirmableParticipantIdentityIssue(issues, participantA)).toBe(true);
    expect(hasConfirmableParticipantIdentityIssue(issues, participantB)).toBe(false);
    expect(hasConfirmableParticipantIdentityIssue(issues, "76561198000000003")).toBe(false);
  });
});

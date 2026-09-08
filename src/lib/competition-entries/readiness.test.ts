import { describe, expect, it } from "vitest";
import { normalizeTeamRegistrationConfig } from "@/lib/seasons/compatibility";
import { assessEntryRosterReadiness } from "./readiness";

describe("assessEntryRosterReadiness", () => {
  it("uses the same blocker projection for discipline, confirmation, and team membership", () => {
    const result = assessEntryRosterReadiness({
      entry: { teamId: "team-1", logoUrl: null, perfectTeamId: null },
      season: {
        teamRegistrationConfig: normalizeTeamRegistrationConfig({ requireTeamLogo: true, requireCompetitiveProfile: true }),
        minTeamSize: 1,
        maxTeamSize: 5,
        starterCount: 1,
      },
      members: [{ userId: "player-1", label: "甲同学", primary: true, participantStatus: "invited" }],
      qualificationFindings: [],
      registrationBlockedUserIds: new Set(),
      rosterBlockedUserIds: new Set(["player-1"]),
      currentTeamMemberUserIds: new Set(),
      requireCurrentTeamMembership: true,
      requireActiveRestrictionOverrides: false,
    });

    expect(result).toMatchObject({ rosterSize: 1, confirmedCount: 0, primaryStarterCount: 1 });
    expect(result.blockers).toEqual([
      "所有名单成员都需确认代表本届赛事参赛。",
      "以下成员当前不能进入赛事名单：甲同学",
      "当前名单中有人已不再是这支队伍的当前成员；选择会保留，但提交前必须明确处理。",
      "请先上传队伍图标并保存本届名单。",
      "本届赛事要求完美战队 ID。",
    ]);
  });
});

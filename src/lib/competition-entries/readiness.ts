import type { competitionEntries, competitionEntryRestrictionOverrides } from "@/db/schema";
import { unresolvedQualificationFindings } from "@/lib/competition-entries/restriction-overrides";
import type { QualificationFinding } from "@/lib/qualification/finding";
import { normalizeTeamRegistrationConfig } from "@/lib/seasons/compatibility";
import type { Season } from "@/types/season";

type EntryReadinessMember = {
  userId: string;
  label: string;
  primary: boolean;
  participantStatus: string;
};

export interface EntryRosterReadiness {
  blockers: string[];
  rosterSize: number;
  confirmedCount: number;
  primaryStarterCount: number;
}

/**
 * Canonical submit-readiness projection for a CompetitionEntry roster.
 *
 * Callers load the authoritative facts appropriate to their consistency
 * boundary, then use this pure projection for both command validation and
 * admin-facing progress. This keeps a draft's visible blockers aligned with
 * the conditions that actually prevent submission.
 */
export function assessEntryRosterReadiness(input: {
  entry: Pick<typeof competitionEntries.$inferSelect, "teamId" | "logoUrl">;
  season: Pick<Season, "teamRegistrationConfig" | "minTeamSize" | "maxTeamSize" | "starterCount">;
  members: readonly EntryReadinessMember[];
  qualificationFindings: readonly QualificationFinding[];
  registrationBlockedUserIds: ReadonlySet<string>;
  rosterBlockedUserIds: ReadonlySet<string>;
  currentTeamMemberUserIds?: ReadonlySet<string>;
  requireCurrentTeamMembership: boolean;
  requireActiveRestrictionOverrides: boolean;
  activeRestrictionOverrides?: readonly (typeof competitionEntryRestrictionOverrides.$inferSelect)[];
}): EntryRosterReadiness {
  const blockers: string[] = [];
  const rosterSize = input.members.length;
  const confirmedCount = input.members.filter((member) => member.participantStatus === "confirmed").length;
  const primaryStarterCount = input.members.filter((member) => member.primary).length;
  const config = normalizeTeamRegistrationConfig(input.season.teamRegistrationConfig);

  if (rosterSize < input.season.minTeamSize || rosterSize > input.season.maxTeamSize) {
    blockers.push(`本届名单需为 ${input.season.minTeamSize}-${input.season.maxTeamSize} 人。`);
  }
  if (confirmedCount !== rosterSize) {
    blockers.push("所有名单成员都需确认代表本届赛事参赛。");
  }
  const primaryIds = input.members.filter((member) => member.primary).map((member) => member.userId);
  if (input.season.starterCount > 0 && (primaryIds.length !== input.season.starterCount || new Set(primaryIds).size !== input.season.starterCount)) {
    blockers.push(`必须指定恰好 ${input.season.starterCount} 名预定主力。`);
  }

  const labelsFor = (userIds: ReadonlySet<string>) => input.members
    .filter((member) => userIds.has(member.userId))
    .map((member) => member.label);
  const registrationBlockedLabels = labelsFor(input.registrationBlockedUserIds);
  if (registrationBlockedLabels.length > 0) blockers.push(`以下成员当前被禁止报名：${registrationBlockedLabels.join("、")}`);
  const rosterBlockedLabels = labelsFor(input.rosterBlockedUserIds);
  if (rosterBlockedLabels.length > 0) blockers.push(`以下成员当前不能进入赛事名单：${rosterBlockedLabels.join("、")}`);

  if (input.requireCurrentTeamMembership && input.entry.teamId) {
    const currentMembers = input.currentTeamMemberUserIds ?? new Set<string>();
    if (input.members.some((member) => !currentMembers.has(member.userId))) {
      blockers.push("当前名单中有人已不再是这支队伍的当前成员；选择会保留，但提交前必须明确处理。");
    }
  }
  if (config.requireTeamLogo && !input.entry.logoUrl) blockers.push("请先上传队伍图标并保存本届名单。");
  if (input.qualificationFindings.length > 0) {
    const unresolved = input.requireActiveRestrictionOverrides
      ? unresolvedQualificationFindings(input.qualificationFindings, input.activeRestrictionOverrides ?? [])
      : input.qualificationFindings.filter((finding) => !finding.waivable);
    blockers.push(...unresolved.map((finding) => finding.message));
  }

  return {
    blockers: [...new Set(blockers)],
    rosterSize,
    confirmedCount,
    primaryStarterCount,
  };
}

import { evaluateRosterEducationEligibility, resolveSeasonEducationVerification } from "@/lib/education/eligibility";
import { evaluateExternalStrengthRule } from "@/lib/major/player-strength";
import { uniqueQualificationFindings, type QualificationFinding } from "@/lib/qualification/finding";
import type { EvaluateRoster } from "@/lib/seasons/rules";

/** Pure roster-level checks; callers must also evaluate each participant. Inputs must be assembled in one transaction. */
export const evaluateRoster: EvaluateRoster = (candidate, rules, evidence) => {
  const findings: QualificationFinding[] = [];
  const block = (code: string, message: string, metadata?: Record<string, unknown>) => {
    findings.push({ code, message, waivable: false, ...(metadata ? { metadata } : {}) });
  };
  const { entry, revision, members } = candidate;
  if (entry.competitionId !== candidate.season.id || revision.entryId !== entry.id || revision.id !== entry.currentRosterRevisionId) block("roster_revision_mismatch", "名单版本已变化，请刷新后重试。");
  if (new Set(members.map((member) => member.userId)).size !== members.length || new Set(members.map((member) => member.participantId)).size !== members.length) block("roster_duplicate_member", "名单中存在重复成员。");
  if (members.length < rules.roster.minTeamSize || members.length > rules.roster.maxTeamSize) block("roster_size", `本届名单需为 ${rules.roster.minTeamSize}-${rules.roster.maxTeamSize} 人。`);
  if (members.filter((member) => member.isPrimaryStarter).length !== rules.lineup.starterCount) block("roster_starters", `必须指定恰好 ${rules.lineup.starterCount} 名预定主力。`);
  if (entry.source === "linked_team" && (!candidate.currentTeamMemberUserIds || members.some((member) => !candidate.currentTeamMemberUserIds!.has(member.userId)))) block("roster_membership", "名单成员必须是关联队伍的当前成员。");
  if (entry.source === "event_native" && members.some((member) => candidate.nativeRegistrationsByUser.get(member.userId)?.status !== "approved")) block("native_registrations_unavailable", "无法确认所有名单成员已通过个人报名审核。");
  if (members.some((member) => member.status !== "confirmed" || candidate.activeClaimEntryByUser.get(member.userId) !== entry.id)) block("roster_commitment", "所有名单成员均需确认代表本队参赛。");
  if (members.some((member) => candidate.registrationBlockedUserIds.has(member.userId))) block("registration_block", "名单中有成员当前被禁止报名。");
  if (members.some((member) => candidate.rosterBlockedUserIds.has(member.userId))) block("roster_block", "名单中有成员当前不能进入赛事名单。");
  if (rules.roster.requireTeamLogo && !entry.logoPresent) block("entry_logo_required", "请先上传队伍图标。");
  if (rules.roster.requireUniqueTeamName && entry.nameConflicts) block("entry_name_conflict", "本届赛事已有同名参赛队。");
  if (rules.roster.requirePositions && members.some((member) => !member.primaryPosition || !rules.roster.positions.includes(member.primaryPosition))) block("roster_position_required", "请为所有成员选择本届赛事允许的位置。");
  if (rules.roster.maxPerPositionPerTeam > 0) {
    const positions = new Map<string, number>();
    for (const member of members) if (member.primaryPosition) positions.set(member.primaryPosition, (positions.get(member.primaryPosition) ?? 0) + 1);
    if ([...positions.values()].some((count) => count > rules.roster.maxPerPositionPerTeam)) block("roster_position_limit", `同一位置最多 ${rules.roster.maxPerPositionPerTeam} 人。`);
  }
  const educationMembers = members.map((member) => {
    const fact = candidate.factsByUser.get(member.userId);
    if (!fact) block("participant_missing", "名单成员资料不可用。", { userId: member.userId });
    return { userId: member.userId, label: fact?.displayName ?? fact?.perfectName ?? member.userId, emailVerifiedAt: fact?.emailVerifiedAt ?? null, verificationHistory: fact?.educationHistory ?? [] };
  });
  const education = evaluateRosterEducationEligibility(educationMembers, rules.roster.affiliationRules, { requireMemberEducation: false, requireVerifiedEmail: false, requireApprovedAffiliation: true });
  findings.push(...education.blockers.map((message) => ({ code: "education_incomplete", message, waivable: false, metadata: { field: "affiliation" } })));
  if (rules.competitive.externalStrengthGap.enabled) {
    if (evidence.kind !== "competitive" || !evidence.context.profile) block("competitive_context_unavailable", "该赛事采用的竞技资料暂时无法核验。");
    else {
      const starters = members.filter((member) => member.isPrimaryStarter);
      const players = starters.flatMap((member) => {
        const strength = evidence.byPurpose.externalStrength.get(member.userId);
        if (!strength) { block("competitive_profile_incomplete", "名单成员竞技资料不可用。", { userId: member.userId }); return []; }
        const fact = candidate.factsByUser.get(member.userId);
        const isHome = resolveSeasonEducationVerification(fact?.educationHistory ?? [], rules.roster.affiliationRules).eligibilityState === "approved" && Boolean(resolveSeasonEducationVerification(fact?.educationHistory ?? [], rules.roster.affiliationRules).matchedRule);
        const historicalPeak = strength.rank ? { rank: strength.rank, rating: 0, ratingComparable: false, stars: strength.stars, sourcePlatform: strength.sourcePlatform, sourceSeasonKey: strength.sourceSeasonKey, ...(strength.sourceRank ? { sourceRank: strength.sourceRank } : {}) } : null;
        return [{ userId: member.userId, label: strength.label, historicalPeak, previousSeasonPeak: null, currentSeasonPeak: null, isHome }];
      });
      findings.push(...evaluateExternalStrengthRule({ players, config: { ...evidence.context.profile, externalStrengthMaxStarGap: rules.competitive.externalStrengthGap.maxGap } }).findings);
    }
  }
  const unique = uniqueQualificationFindings(findings);
  return unique.length === 0 ? { state: "ready", findings: [] } : { state: "blocked", findings: [unique[0], ...unique.slice(1)] };
};

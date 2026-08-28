import type { InstitutionAffiliationRule } from "@/types/season";

export type EducationEligibilityMember = {
  userId: string;
  emailVerifiedAt: Date | null;
  email: string;
  verification: {
    id: string;
    institutionCode: string | null;
    institutionName: string;
    academicStatus: "enrolled" | "graduated";
    status: "pending" | "approved" | "rejected";
  } | null;
  verificationHistory?: readonly SeasonEducationVerification[];
};

export type SeasonEducationVerification = NonNullable<EducationEligibilityMember["verification"]> & {
  submittedAt?: Date | null;
};

export interface SeasonAffiliationResolution {
  selectedVerification: SeasonEducationVerification | null;
  matchedRule: InstitutionAffiliationRule | null;
  eligibilityState: "missing" | "pending" | "rejected" | "approved" | "unmatched";
}

/**
 * Pick the education assertion that applies to this season. A matching
 * approved assertion always wins over a newer unrelated assertion; otherwise
 * the newest approved assertion remains the participant's active record.
 */
export function resolveSeasonEducationVerification(
  history: readonly SeasonEducationVerification[],
  rules: readonly InstitutionAffiliationRule[],
): SeasonAffiliationResolution {
  const newestFirst = [...history].sort((left, right) =>
    (right.submittedAt?.getTime() ?? 0) - (left.submittedAt?.getTime() ?? 0),
  );
  const approved = newestFirst.filter((item) => item.status === "approved");
  const matching = approved.find((item) => rules.some((rule) =>
    rule.institutionCode === item.institutionCode && rule.eligibleAcademicStatuses.includes(item.academicStatus),
  ));
  const selectedVerification = matching ?? approved[0] ?? newestFirst[0] ?? null;
  const matchedRule = selectedVerification
    ? rules.find((rule) => rule.institutionCode === selectedVerification.institutionCode && rule.eligibleAcademicStatuses.includes(selectedVerification.academicStatus)) ?? null
    : null;
  if (!selectedVerification) return { selectedVerification, matchedRule, eligibilityState: "missing" };
  if (selectedVerification.status === "pending") return { selectedVerification, matchedRule, eligibilityState: "pending" };
  if (selectedVerification.status === "rejected") return { selectedVerification, matchedRule, eligibilityState: "rejected" };
  return { selectedVerification, matchedRule, eligibilityState: rules.length === 0 || matchedRule ? "approved" : "unmatched" };
}

export interface EducationEligibilityResult {
  eligible: boolean;
  blockers: string[];
  selectedVerificationIds: Map<string, string>;
  affiliationCounts: Map<string, number>;
}

/**
 * Authoritative application-side eligibility decision. It consumes approved
 * verification rows, never profile/studentId heuristics.
 */
export function evaluateRosterEducationEligibility(
  members: readonly EducationEligibilityMember[],
  rules: readonly InstitutionAffiliationRule[],
): EducationEligibilityResult {
  const blockers: string[] = [];
  const selectedVerificationIds = new Map<string, string>();
  const affiliationCounts = new Map<string, number>();

  for (const member of members) {
    if (!member.emailVerifiedAt) {
      blockers.push(`${member.email} 的邮箱尚未验证，请先验证当前账号邮箱。`);
      continue;
    }
    const resolution = resolveSeasonEducationVerification(member.verificationHistory ?? (member.verification ? [member.verification] : []), rules);
    const verification = resolution.selectedVerification;
    if (!verification) {
      blockers.push(`${member.email} 尚未完成教育身份认证。`);
      continue;
    }
    if (verification.status === "pending") {
      blockers.push(`${member.email} 的教育身份认证仍在审核中。`);
      continue;
    }
    if (verification.status === "rejected") {
      blockers.push(`${member.email} 的教育身份认证已被驳回，请重新提交。`);
      continue;
    }
    selectedVerificationIds.set(member.userId, verification.id);
    if (verification.institutionCode) {
      affiliationCounts.set(
        verification.institutionCode,
        (affiliationCounts.get(verification.institutionCode) ?? 0) + 1,
      );
    }
  }

  for (const rule of rules) {
    const count = members.filter((member) =>
      member.emailVerifiedAt !== null &&
      resolveSeasonEducationVerification(member.verificationHistory ?? (member.verification ? [member.verification] : []), rules).matchedRule === rule,
    ).length;
    affiliationCounts.set(rule.institutionCode, count);
    if (count < rule.minRosterMembers) {
      const shortfall = rule.minRosterMembers - count;
      const label = rule.institutionCode === "4132010284" ? "南京大学" : rule.institutionCode;
      blockers.push(`当前已认证${label}成员 ${count} 人，Major 正式名单至少需要 ${rule.minRosterMembers} 人；还缺 ${shortfall} 人。`);
    }
  }

  return { eligible: blockers.length === 0, blockers, selectedVerificationIds, affiliationCounts };
}

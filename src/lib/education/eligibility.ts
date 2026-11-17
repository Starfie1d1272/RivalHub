import type { InstitutionAffiliationRule } from "@/types/season";

export type EducationEligibilityMember = {
  userId: string;
  label: string;
  emailVerifiedAt: Date | null;
  /** Optional: callers may pass only `verificationHistory` when they already loaded assertions. */
  verification?: {
    id: string;
    institutionCode: string | null;
    institutionName: string;
    academicStatus: "enrolled" | "graduated";
    status: "pending" | "approved" | "rejected";
  } | null;
  verificationHistory?: readonly SeasonEducationVerification[];
};

export type SeasonEducationVerification = NonNullable<
  EducationEligibilityMember["verification"]
> & {
  submittedAt?: Date | null;
};

export interface SeasonAffiliationResolution {
  selectedVerification: SeasonEducationVerification | null;
  matchedRule: InstitutionAffiliationRule | null;
  eligibilityState: "missing" | "pending" | "rejected" | "approved" | "unmatched";
}

function matchesAffiliationRule(
  verification: SeasonEducationVerification,
  rule: InstitutionAffiliationRule,
): boolean {
  return (
    rule.institutionCode === verification.institutionCode &&
    rule.eligibleAcademicStatuses.includes(verification.academicStatus)
  );
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
  const newestFirst = [...history].sort(
    (left, right) => (right.submittedAt?.getTime() ?? 0) - (left.submittedAt?.getTime() ?? 0),
  );
  const approved = newestFirst.filter((item) => item.status === "approved");
  const matching = approved.find((item) =>
    rules.some((rule) => matchesAffiliationRule(item, rule)),
  );
  const selectedVerification = matching ?? approved[0] ?? newestFirst[0] ?? null;
  const matchedRule = selectedVerification
    ? (rules.find((rule) => matchesAffiliationRule(selectedVerification, rule)) ?? null)
    : null;
  if (!selectedVerification)
    return { selectedVerification, matchedRule, eligibilityState: "missing" };
  if (selectedVerification.status === "pending")
    return { selectedVerification, matchedRule, eligibilityState: "pending" };
  if (selectedVerification.status === "rejected")
    return { selectedVerification, matchedRule, eligibilityState: "rejected" };
  return {
    selectedVerification,
    matchedRule,
    eligibilityState: rules.length === 0 || matchedRule ? "approved" : "unmatched",
  };
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
  const approvedVerifications: SeasonEducationVerification[] = [];

  for (const member of members) {
    if (!member.emailVerifiedAt) {
      blockers.push(`${member.label} 的邮箱尚未验证，请先验证当前账号邮箱。`);
      continue;
    }
    const resolution = resolveSeasonEducationVerification(
      member.verificationHistory ?? (member.verification ? [member.verification] : []),
      rules,
    );
    const verification = resolution.selectedVerification;
    if (!verification) {
      blockers.push(`${member.label} 尚未完成教育身份认证。`);
      continue;
    }
    if (verification.status === "pending") {
      blockers.push(`${member.label} 的教育身份认证仍在审核中。`);
      continue;
    }
    if (verification.status === "rejected") {
      blockers.push(`${member.label} 的教育身份认证已被驳回，请重新提交。`);
      continue;
    }
    selectedVerificationIds.set(member.userId, verification.id);
    approvedVerifications.push(verification);
    if (verification.institutionCode) {
      affiliationCounts.set(
        verification.institutionCode,
        (affiliationCounts.get(verification.institutionCode) ?? 0) + 1,
      );
    }
  }

  for (const rule of rules) {
    const count = approvedVerifications.filter((verification) =>
      matchesAffiliationRule(verification, rule),
    ).length;
    if (count < rule.minRosterMembers) {
      const shortfall = rule.minRosterMembers - count;
      const label = rule.institutionCode === "4132010284" ? "南京大学" : rule.institutionCode;
      blockers.push(
        `当前已认证${label}成员 ${count} 人，Major 正式名单至少需要 ${rule.minRosterMembers} 人；还缺 ${shortfall} 人。`,
      );
    }
  }

  return { eligible: blockers.length === 0, blockers, selectedVerificationIds, affiliationCounts };
}

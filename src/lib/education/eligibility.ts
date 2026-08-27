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
};

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
    if (!member.verification) {
      blockers.push(`${member.email} 尚未完成教育身份认证。`);
      continue;
    }
    if (member.verification.status === "pending") {
      blockers.push(`${member.email} 的教育身份认证仍在审核中。`);
      continue;
    }
    if (member.verification.status === "rejected") {
      blockers.push(`${member.email} 的教育身份认证已被驳回，请重新提交。`);
      continue;
    }
    selectedVerificationIds.set(member.userId, member.verification.id);
    if (member.verification.institutionCode) {
      affiliationCounts.set(
        member.verification.institutionCode,
        (affiliationCounts.get(member.verification.institutionCode) ?? 0) + 1,
      );
    }
  }

  for (const rule of rules) {
    const count = members.filter((member) =>
      member.emailVerifiedAt !== null &&
      member.verification?.status === "approved" &&
      member.verification.institutionCode === rule.institutionCode &&
      rule.eligibleAcademicStatuses.includes(member.verification.academicStatus),
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

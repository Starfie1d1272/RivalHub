import { qualificationFindingCoveredByApproval, type QualificationFinding } from "@/lib/qualification/finding";
import { evaluateExternalStrengthRule } from "@/lib/major/player-strength";
import type { InstitutionAffiliationRule } from "@/types/season";
import type { MatchLineupPolicy } from "./policy";

/**
 * G1 contract for match starting lineups. A lineup may only ever come from an
 * explicit submit/confirm flow; nothing in this module infers starters from
 * mutable membership ordering or any other implicit fallback.
 */

export interface LineupVerificationFact {
  institutionCode: string | null;
  academicStatus: "enrolled" | "graduated";
  status: "pending" | "approved" | "rejected";
}

/** The membership facts that must be resolved before a lineup can be judged. */
export interface LineupMemberFact {
  eventRosterMemberId: string;
  userId: string;
  verification: LineupVerificationFact | null;
  /** Set when an active disciplinary sanction blocks this player's participation. */
  participationBlocked?: boolean;
}

export interface StartingLineupInput {
  starterIds: readonly string[];
  substituteIds?: readonly string[];
  /** Resolved once from the frozen Major StageRun or the published season rule. */
  policy: MatchLineupPolicy;
  /** Facts for every team member selectable on this canonical team. */
  memberFacts: ReadonlyMap<string, LineupMemberFact>;
  /**
   * Frozen tournament roster user ids (Major prestart snapshot). When present,
   * every selected player must appear in it.
   */
  frozenRosterUserIds?: ReadonlySet<string>;
  /**
   * Affiliation rules frozen in the StageRun ruleSnapshot. When present,
   * per-institution starter minimums are enforced.
   * Never pass rules read from mutable season config here.
   */
  affiliationRules?: readonly InstitutionAffiliationRule[];
  /** Legacy callers with affiliation rules required every selected member. */
  educationRequired?: boolean;
}

export interface StartingLineupResult {
  valid: boolean;
  status: "ready" | "blocked";
  findings: QualificationFinding[];
  blockers: string[];
  /** Approved, academically-eligible starter count per institution code. */
  affiliatedStarterCounts: Map<string, number>;
}

function institutionLabel(code: string): string {
  return code === "4132010284" ? "南京大学" : code;
}

function isEligibleForRule(
  fact: LineupMemberFact,
  rule: InstitutionAffiliationRule,
): boolean {
  return Boolean(
    fact.verification &&
      fact.verification.status === "approved" &&
      fact.verification.institutionCode === rule.institutionCode &&
      rule.eligibleAcademicStatuses.includes(fact.verification.academicStatus),
  );
}

/**
 * Pure referee for a proposed match lineup. Deterministic, DB-free; both the
 * confirm flow and the start gate must run it against freshly loaded facts.
 */
export function evaluateStartingLineup(input: StartingLineupInput): StartingLineupResult {
  const { starterIds, substituteIds = [], memberFacts, policy } = input;
  const findings: QualificationFinding[] = [];
  const block = (code: string, message: string, metadata?: Record<string, unknown>) =>
    findings.push({ code, message, waivable: false, ...(metadata ? { metadata } : {}) });
  const affiliatedStarterCounts = new Map<string, number>();

  if (starterIds.length !== policy.starterCount) {
    block("lineup_starter_count", `必须选择 ${policy.starterCount} 名首发，当前选择了 ${starterIds.length} 名。`);
  }
  if (substituteIds.length > policy.maxSubstitutes) {
    block("lineup_substitute_count", policy.maxSubstitutes === 0
      ? `本赛事每队本场只能提交恰好 ${policy.starterCount} 名首发，不设置替补名单。`
      : `替补不能超过 ${policy.maxSubstitutes} 人，当前选择了 ${substituteIds.length} 名。`);
  }

  const seen = new Set<string>();
  let duplicateCount = 0;
  for (const id of [...starterIds, ...substituteIds]) {
    if (seen.has(id)) duplicateCount += 1;
    seen.add(id);
  }
  if (duplicateCount > 0) {
    block("lineup_duplicate_member", "同一名队员被重复选择，不能提交。");
  }

  const unknownCount = [...starterIds, ...substituteIds].filter((id) => !memberFacts.has(id)).length;
  if (unknownCount > 0) {
    block("lineup_unknown_member", `有 ${unknownCount} 名所选队员不属于本队，不能提交。`);
  }

  const blockedCount =
    [...starterIds, ...substituteIds].filter((id) => memberFacts.get(id)?.participationBlocked).length;
  if (blockedCount > 0) {
    block("lineup_participation_blocked", `有 ${blockedCount} 名队员正在受纪律处罚禁赛期内，不能参加本场比赛。`);
  }

  const starterFacts: LineupMemberFact[] = [];
  const substituteFacts: LineupMemberFact[] = [];
  for (const id of starterIds) {
    const fact = memberFacts.get(id);
    if (fact) starterFacts.push(fact);
  }
  for (const id of substituteIds) {
    const fact = memberFacts.get(id);
    if (fact) substituteFacts.push(fact);
  }

  if (input.frozenRosterUserIds) {
    const outsiders =
      [...starterFacts, ...substituteFacts].filter(
        (fact) => !input.frozenRosterUserIds!.has(fact.userId),
      ).length;
    if (outsiders > 0) {
      block("lineup_outside_frozen_roster", `有 ${outsiders} 名所选队员不在本届赛事冻结名单内，不能作为本场参赛选手。`);
    }
  }

  if (input.affiliationRules) {
    const rules = input.affiliationRules!;
    const allSelected = [...starterFacts, ...substituteFacts];
    if ((input.educationRequired ?? true) && allSelected.some((fact) => !fact.verification || fact.verification.status !== "approved")) {
      block("lineup_education_required", "有队员的教育身份认证已失效或未通过审核，已失去本届比赛资格。");
    }
    for (const rule of rules) {
      const count = starterFacts.filter((fact) => isEligibleForRule(fact, rule)).length;
      affiliatedStarterCounts.set(rule.institutionCode, count);
      if (rule.minStartingMembers > 0 && count < rule.minStartingMembers) {
        const shortfall = rule.minStartingMembers - count;
        block(
          "lineup_institution_minimum",
          `首发阵容中已认证${institutionLabel(rule.institutionCode)}成员 ${count} 人，至少需要 ${rule.minStartingMembers} 人；还缺 ${shortfall} 人。`,
          { institutionCode: rule.institutionCode },
        );
      }
    }
  }

  const blockers = findings.map((finding) => finding.message);
  return { valid: findings.length === 0, status: findings.length === 0 ? "ready" : "blocked", findings, blockers, affiliatedStarterCounts };
}

/** Evaluate a lineup solely against its adopted facts and current participation sanctions. */
export const evaluateLineup: import("@/lib/seasons/rules").EvaluateLineup = (proposed, frozen, participationBlockedUserIds) => {
  const findings: QualificationFinding[] = [];
  if (proposed.entryId !== frozen.entryId) {
    findings.push({ code: "lineup_entry_mismatch", message: "阵容与冻结名单所属队伍不一致。", waivable: false });
  }
  const members = new Map([...frozen.membersById].map(([id, member]) => [id, {
    ...member,
    participationBlocked: participationBlockedUserIds.has(member.userId),
  }]));
  findings.push(...evaluateStartingLineup({
    starterIds: proposed.starterMemberIds,
    substituteIds: proposed.substituteMemberIds,
    policy: { starterCount: frozen.starterCount, maxSubstitutes: frozen.maxSubstitutes },
    memberFacts: members,
    affiliationRules: frozen.affiliationRules,
    educationRequired: frozen.educationRequired,
  }).findings);

  if (frozen.competitiveProfileRequired || frozen.externalStrengthGap.enabled) {
    const evidence = frozen.evidence;
    if (evidence.kind !== "competitive" || !evidence.context.profile) {
      findings.push({ code: "competitive_context_unavailable", message: "冻结的竞技资格事实或规则不可用。", waivable: false });
    } else {
      // Per-season evidence completeness must be assessed by the competitive evidence owner.
      // Until that evaluator is wired here, do not accept a required profile as complete.
      if (frozen.competitiveProfileRequired) findings.push({ code: "competitive_requirements_unavailable", message: "冻结的竞技资格要求尚无法完成校验。", waivable: false });
      const players = proposed.starterMemberIds.flatMap((id) => {
        const member = members.get(id);
        if (!member) return [];
        const fact = evidence.byUser.get(member.userId);
        if (!fact) {
          findings.push({ code: "competitive_profile_incomplete", message: `首发 ${member.userId} 缺少冻结的竞技事实。`, waivable: false, metadata: { userId: member.userId } });
          return [];
        }
        const isHome = frozen.affiliationRules.some((rule) => isEligibleForRule(member, rule));
        return [{ ...fact.strength, isHome }];
      });
      if (frozen.externalStrengthGap.enabled && players.length === proposed.starterMemberIds.length) {
        const result = evaluateExternalStrengthRule({ players, config: { ...evidence.context.profile, externalStrengthMaxStarGap: frozen.externalStrengthGap.maxGap } });
        findings.push(...result.findings.filter((finding) => !finding.waivable || !frozen.overrides.some((override) =>
          override.restrictionCode === finding.code && qualificationFindingCoveredByApproval(override.findingSnapshot, finding))));
      }
    }
  }
  return findings.length === 0 ? { state: "ready", findings: [] } : { state: "blocked", findings: [findings[0], ...findings.slice(1)] };
};

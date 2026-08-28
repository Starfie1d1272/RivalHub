import type { InstitutionAffiliationRule } from "@/types/season";

/**
 * G1 contract for match starting lineups. A lineup may only ever come from an
 * explicit submit/confirm flow; nothing in this module infers starters from
 * team_members ordering or any other implicit fallback.
 */

export const STARTER_COUNT = 5;

export interface LineupVerificationFact {
  institutionCode: string | null;
  academicStatus: "enrolled" | "graduated";
  status: "pending" | "approved" | "rejected";
}

/** The membership facts that must be resolved before a lineup can be judged. */
export interface LineupMemberFact {
  teamMemberId: string;
  userId: string;
  verification: LineupVerificationFact | null;
  /** Set when an active disciplinary sanction blocks this player's participation. */
  participationBlocked?: boolean;
}

export interface StartingLineupInput {
  starterIds: readonly string[];
  substituteIds?: readonly string[];
  /** Legacy formats may retain stored substitutes; Major lineups are five starters only. */
  allowSubstitutes?: boolean;
  /** Facts for every team member selectable on this canonical team. */
  memberFacts: ReadonlyMap<string, LineupMemberFact>;
  /**
   * Frozen tournament roster user ids (Major prestart snapshot). When present,
   * every selected player must appear in it.
   */
  frozenRosterUserIds?: ReadonlySet<string>;
  /**
   * Affiliation rules frozen in the StageRun ruleSnapshot. When present,
   * education validity and per-institution starter minimums are enforced.
   * Never pass rules read from mutable season config here.
   */
  affiliationRules?: readonly InstitutionAffiliationRule[];
}

export interface StartingLineupResult {
  valid: boolean;
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
  const { starterIds, substituteIds = [], memberFacts, allowSubstitutes = true } = input;
  const blockers: string[] = [];
  const affiliatedStarterCounts = new Map<string, number>();

  if (starterIds.length !== STARTER_COUNT) {
    blockers.push(`必须选择 ${STARTER_COUNT} 名首发，当前选择了 ${starterIds.length} 名。`);
  }
  if (!allowSubstitutes && substituteIds.length > 0) {
    blockers.push("本赛事每队本场只能提交恰好 5 名首发，不设置替补名单。");
  } else if (allowSubstitutes && substituteIds.length > 2) {
    blockers.push(`历史赛制替补不能超过 2 人，当前选择了 ${substituteIds.length} 名。`);
  }

  const seen = new Set<string>();
  let duplicateCount = 0;
  for (const id of [...starterIds, ...substituteIds]) {
    if (seen.has(id)) duplicateCount += 1;
    seen.add(id);
  }
  if (duplicateCount > 0) {
    blockers.push("同一名队员被重复选择，不能提交。");
  }

  const unknownCount = [...starterIds, ...substituteIds].filter((id) => !memberFacts.has(id)).length;
  if (unknownCount > 0) {
    blockers.push(`有 ${unknownCount} 名所选队员不属于本队，不能提交。`);
  }

  const blockedCount =
    [...starterIds, ...substituteIds].filter((id) => memberFacts.get(id)?.participationBlocked).length;
  if (blockedCount > 0) {
    blockers.push(`有 ${blockedCount} 名队员正在受纪律处罚禁赛期内，不能参加本场比赛。`);
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
      blockers.push(`有 ${outsiders} 名所选队员不在本届赛事冻结名单内，不能作为本场参赛选手。`);
    }
  }

  if (input.affiliationRules) {
    const rules = input.affiliationRules!;
    const allSelected = [...starterFacts, ...substituteFacts];
    if (allSelected.some((fact) => !fact.verification || fact.verification.status !== "approved")) {
      blockers.push("有队员的教育身份认证已失效或未通过审核，已失去本届比赛资格。");
    }
    for (const rule of rules) {
      const count = starterFacts.filter((fact) => isEligibleForRule(fact, rule)).length;
      affiliatedStarterCounts.set(rule.institutionCode, count);
      if (rule.minStartingMembers > 0 && count < rule.minStartingMembers) {
        const shortfall = rule.minStartingMembers - count;
        blockers.push(
          `首发阵容中已认证${institutionLabel(rule.institutionCode)}成员 ${count} 人，至少需要 ${rule.minStartingMembers} 人；还缺 ${shortfall} 人。`,
        );
      }
    }
  }

  return { valid: blockers.length === 0, blockers, affiliatedStarterCounts };
}

import { AppError, ErrorCode } from "@/lib/errors";
import { normalizeAffiliationRules, type InstitutionAffiliationRule } from "@/types/season";

/**
 * The tournament-facing affiliation contract. G1 match-roster validation must
 * read this from a StageRun ruleSnapshot, never the mutable season row.
 */
export function freezeAffiliationRules(
  rules: readonly InstitutionAffiliationRule[],
): readonly InstitutionAffiliationRule[] {
  return normalizeAffiliationRules(rules).map((rule) => ({
    institutionCode: rule.institutionCode,
    eligibleAcademicStatuses: [...rule.eligibleAcademicStatuses],
    minRosterMembers: rule.minRosterMembers,
    minStartingMembers: rule.minStartingMembers,
  }));
}

export function frozenStageRunAffiliationRules(
  ruleSnapshot: unknown,
): readonly InstitutionAffiliationRule[] {
  if (!ruleSnapshot || typeof ruleSnapshot !== "object") {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 缺少冻结的高校归属规则。");
  }
  const rules = (ruleSnapshot as { affiliationRules?: unknown }).affiliationRules;
  if (!Array.isArray(rules)) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 缺少冻结的高校归属规则。");
  }
  const structurallyValid = rules.every((rule) => {
    if (!rule || typeof rule !== "object") return false;
    const candidate = rule as Partial<InstitutionAffiliationRule>;
    return typeof candidate.institutionCode === "string" && candidate.institutionCode.trim().length > 0 &&
      Array.isArray(candidate.eligibleAcademicStatuses) && candidate.eligibleAcademicStatuses.length > 0 &&
      candidate.eligibleAcademicStatuses.every((status) => status === "enrolled" || status === "graduated") &&
      typeof candidate.minRosterMembers === "number" && Number.isInteger(candidate.minRosterMembers) && candidate.minRosterMembers >= 0 &&
      typeof candidate.minStartingMembers === "number" && Number.isInteger(candidate.minStartingMembers) && candidate.minStartingMembers >= 0;
  });
  if (!structurallyValid) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结的高校归属规则不可用。");
  }
  const normalized = normalizeAffiliationRules(rules as InstitutionAffiliationRule[]);
  if (normalized.length !== rules.length) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun 冻结的高校归属规则不可用。");
  }
  return freezeAffiliationRules(normalized);
}

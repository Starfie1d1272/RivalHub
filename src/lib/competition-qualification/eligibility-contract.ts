import type { PlayerStrengthInput } from "@/lib/major/player-strength";
import type { FrozenRestrictionOverrideSnapshot } from "@/lib/major/run-snapshot";
import type { CompetitiveProfileConfig, InstitutionAffiliationRule } from "@/types/season";

export interface QualificationEligibilityPolicy {
  version: 1;
  affiliationRules: readonly InstitutionAffiliationRule[];
  competitiveProfile: CompetitiveProfileConfig | null;
  starterCount: number;
  maxSubstitutes: number;
  externalStrengthGapEnabled: boolean;
}

export interface QualificationRosterEligibility {
  version: 1;
  entryId: string;
  rosterRevisionId: string;
  policy: QualificationEligibilityPolicy;
  competitiveFacts: PlayerStrengthInput[];
  restrictionOverrides: FrozenRestrictionOverrideSnapshot[];
}

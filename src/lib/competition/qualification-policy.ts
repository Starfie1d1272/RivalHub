import { z } from "zod";
import { AppError, ErrorCode } from "@/lib/errors";
import type { TeamRegistrationConfig } from "@/types/season";

export const competitiveProfileSchema = z.object({
      platform: z.string().min(1).max(64),
      currentSeasonKey: z.string().max(128),
      previousSeasonKey: z.string().max(128),
      rankOrder: z.array(z.string().min(1).max(64)).max(64),
      externalStrengthMaxStarGap: z.number().int().min(0).max(100).optional(),
      conversionPolicyVersion: z.string().max(128).optional(),
      conversionPolicyId: z.string().max(128).optional(),
      evidencePolicy: z.object({
        historicalWeight: z.literal(50),
        referenceSeasonKey: z.string().min(1).max(128),
        referenceSeasonWeight: z.literal(20),
        recentSeasonKeys: z.array(z.string().min(1).max(128)).min(1).max(8),
        recentSeasonWeight: z.literal(30),
        sourceSelection: z.enum(["primary_then_fallback", "strongest_equivalent"]).optional(),
      }).optional(),
      fallbackConversion: z.object({
        sourcePlatform: z.literal("fivee"),
        // A draft can deliberately retain an incomplete operator mapping. It
        // becomes usable only when registration freeze validates every actual
        // evidence slot; empty placeholders are never persisted.
        version: z.string().max(128),
        seasonKeyMap: z.record(z.string().min(1).max(128), z.string().min(1).max(128)),
        // Mapping validation belongs to the conversion-policy owner and is
        // intentionally deferred until registration freeze.
        mapping: z.any().optional(),
        rankMap: z.record(z.string(), z.string()).optional(),
      }).optional(),
    });

export const qualificationPolicySchema = z.object({
  version: z.literal(1),
  educationRequired: z.boolean(),
  affiliationRules: z.array(z.object({
    institutionCode: z.string().min(1),
    eligibleAcademicStatuses: z.array(z.enum(["enrolled", "graduated"])).min(1),
    minRosterMembers: z.number().int().min(0),
    minStartingMembers: z.number().int().min(0),
  })),
  competitiveProfileRequired: z.boolean(),
  competitiveProfile: competitiveProfileSchema.nullable(),
  externalStrengthGap: z.object({ enabled: z.boolean(), maxGap: z.number().int().min(0).max(100) }),
  contacts: z.object({ qqRequired: z.boolean(), emailVerifiedRequired: z.boolean() }),
});

export const qualificationPolicyV2Schema = qualificationPolicySchema.omit({ affiliationRules: true }).extend({ version: z.literal(2) }).strict();

/** Solo registration still uses its historical registration configuration. */
export function assertQualificationPolicyPublishable(config: Pick<TeamRegistrationConfig, "qualificationPolicy">, registrationMode: "team" | "solo", limits: { maxTeamSize: number; starterCount: number }): void {
  if (config.qualificationPolicy && registrationMode !== "team") {
    throw new AppError(ErrorCode.SEASON_CAPABILITY_DISABLED, "版本化资格政策暂不支持个人报名，请使用队伍报名或移除该政策。 ");
  }
  const rules = config.qualificationPolicy?.affiliationRules;
  if (!rules) return;
  // Roster assignment selects one rule per member. Lineup rules for the same
  // institution can overlap, so only their largest minimum is additive across institutions.
  const startingByInstitution = new Map<string, number>();
  for (const rule of rules) {
    startingByInstitution.set(rule.institutionCode, Math.max(startingByInstitution.get(rule.institutionCode) ?? 0, rule.minStartingMembers));
  }
  const rosterMinimum = rules.reduce((sum, rule) => sum + rule.minRosterMembers, 0);
  const startingMinimum = [...startingByInstitution.values()].reduce((sum, minimum) => sum + minimum, 0);
  if (rosterMinimum > limits.maxTeamSize || startingMinimum > limits.starterCount || startingMinimum > limits.maxTeamSize) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "机构名单或首发人数要求超过赛事名单容量，请调整后发布。 ");
  }
}

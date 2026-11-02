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

/** New policies remain draft-only until every entry and roster gate uses them. */
export function assertQualificationPolicyPublishable(config: Pick<TeamRegistrationConfig, "qualificationPolicy">): void {
  if (config.qualificationPolicy) {
    throw new AppError(ErrorCode.SEASON_CAPABILITY_DISABLED, "本届资格政策尚未接入全部报名与名单流程，暂不能发布。");
  }
}

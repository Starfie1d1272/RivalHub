import { z } from "zod";
import { competitiveProfileSchema, qualificationPolicySchema, qualificationPolicyV2Schema } from "@/lib/competition/qualification-policy";

const strengthFactSchema = z.object({
  rank: z.string(), rating: z.number(), ratingComparable: z.boolean().optional(),
  sourcePlatform: z.string().optional(), sourceSeasonKey: z.string().nullable().optional(), sourceRank: z.string().optional(),
  sourceStars: z.number().nullable().optional(), conversionVersion: z.string().optional(), stars: z.number().nullable().optional(),
  estimatedFromUnranked: z.boolean().optional(), estimatedFromSeasonKey: z.string().nullable().optional(), estimatedFromHistorical: z.boolean().optional(),
}).strict();
const findingSchema = z.object({ code: z.string(), message: z.string(), waivable: z.boolean(), metadata: z.record(z.string(), z.unknown()).optional() }).strict();

/** Serializable facts adopted for one Entry revision; no mutable profile lookup is needed. */
export const eventRosterEligibilitySnapshotV2Schema = z.object({
  version: z.literal(2), seasonId: z.string(), entryId: z.string(), rosterRevisionId: z.string(),
  members: z.array(z.object({
    eventRosterMemberId: z.string(), participantId: z.string(), userId: z.string(), isPrimaryStarter: z.boolean(),
    educationVerificationId: z.string().nullable(),
    education: z.object({ institutionCode: z.string().nullable(), academicStatus: z.enum(["enrolled", "graduated"]), status: z.enum(["pending", "approved", "rejected"]) }).strict().nullable(),
    source: z.object({ rosterRevisionId: z.string(), teamMembershipId: z.string().nullable() }).strict(),
  }).strict()),
  rules: z.object({
    qualificationPolicy: qualificationPolicyV2Schema,
    affiliationRules: qualificationPolicySchema.shape.affiliationRules,
    starterCount: z.number().int().min(0), maxSubstitutes: z.number().int().min(0),
  }).strict(),
  competitive: z.object({
    profile: competitiveProfileSchema.nullable(),
    requirements: z.object({ historicalPeak: z.boolean(), seasonKeys: z.array(z.string()), ratingRequired: z.boolean(), exactStarsRequired: z.boolean() }).strict(),
    byPurpose: z.object({
      profileReadiness: z.array(z.object({ userId: z.string(), historicalPeak: strengthFactSchema.nullable(), seasons: z.record(z.string(), strengthFactSchema.nullable()) }).strict()),
      externalStrength: z.array(z.object({ userId: z.string(), label: z.string(), historicalPeak: strengthFactSchema.nullable(), previousSeasonPeak: strengthFactSchema.nullable(), currentSeasonPeak: strengthFactSchema.nullable(), recentSeasonPeaks: z.array(strengthFactSchema.nullable()).optional() }).strict()),
    }).strict(),
  }).strict().nullable(),
  overrides: z.array(z.object({ restrictionCode: z.string(), findingSnapshot: findingSchema, reason: z.string(), grantedBy: z.string(), grantedAt: z.string() }).strict()),
}).strict();
export type EventRosterEligibilitySnapshotV2 = z.infer<typeof eventRosterEligibilitySnapshotV2Schema>;
export function decodeEventRosterEligibilitySnapshotV2(value: unknown): EventRosterEligibilitySnapshotV2 {
  return eventRosterEligibilitySnapshotV2Schema.parse(value);
}

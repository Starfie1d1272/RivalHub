import { z } from "zod";
import { competitiveProfileSchema, qualificationPolicySchema, qualificationPolicyV2Schema } from "@/lib/competition/qualification-policy";

const profileReadinessFactSchema = z.object({ status: z.enum(["ranked", "unranked"]), rank: z.string().nullable(), rating: z.number().nullable(), stars: z.number().nullable(), sourcePlatform: z.string(), sourceSeasonKey: z.string().nullable() }).strict();
const externalStrengthFactSchema = z.object({ userId: z.string(), label: z.string(), rank: z.string().nullable(), stars: z.number().nullable(), sourcePlatform: z.string(), sourceSeasonKey: z.string().nullable(), sourceRank: z.string().nullable() }).strict();
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
    allowedPlayerTypes: z.array(z.enum(["enrolled", "graduated", "external"])),
    rankThreshold: z.object({ currentMin: z.string().nullable(), peakMin: z.string().nullable() }).strict(),
    starterCount: z.number().int().min(0), maxSubstitutes: z.number().int().min(0),
  }).strict(),
  competitive: z.object({
    recentEvidenceSemantics: z.literal("any_usable").optional(),
    profile: competitiveProfileSchema.nullable(),
    requirements: z.object({ historicalPeak: z.boolean(), seasonKeys: z.array(z.string()), ratingRequired: z.boolean(), exactStarsRequired: z.boolean() }).strict(),
    byPurpose: z.object({
      profileReadiness: z.array(z.object({ userId: z.string(), historicalPeak: profileReadinessFactSchema.nullable(), seasons: z.record(z.string(), profileReadinessFactSchema.nullable()) }).strict()),
      rankThreshold: z.array(z.object({ userId: z.string(), currentRank: z.string().nullable(), peakRank: z.string().nullable() }).strict()),
      externalStrength: z.array(externalStrengthFactSchema),
    }).strict(),
  }).strict().nullable(),
  overrides: z.array(z.object({ restrictionCode: z.string(), findingSnapshot: findingSchema, reason: z.string(), grantedBy: z.string(), grantedAt: z.string() }).strict()),
}).strict();
export type EventRosterEligibilitySnapshotV2 = z.infer<typeof eventRosterEligibilitySnapshotV2Schema>;
export function decodeEventRosterEligibilitySnapshotV2(value: unknown): EventRosterEligibilitySnapshotV2 {
  return eventRosterEligibilitySnapshotV2Schema.parse(value);
}

/** Policy shared by a qualification run; individual adopted facts live in its roster snapshots. */
export type QualificationEligibilityPolicyV2 = {
  version: 2;
  rules: EventRosterEligibilitySnapshotV2["rules"];
  competitive: Omit<NonNullable<EventRosterEligibilitySnapshotV2["competitive"]>, "byPurpose"> | null;
};

import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { matches } from "./matches";
import { seasons } from "./seasons";
import { users } from "./users";

export const communityAwardStatusEnum = pgEnum("community_award_status", [
  "pending_review", "rejected", "approved", "withdrawn", "awarded", "not_awarded", "cancelled",
]);
export type CommunityAwardStatus = (typeof communityAwardStatusEnum.enumValues)[number];

/** Community-proposed awards, intentionally separate from official tournament_honors. */
export const communityAwards = pgTable("community_awards", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id, { onDelete: "cascade" }),
  submittedByUserId: uuid("submitted_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  condition: text("condition").notNull(),
  prize: text("prize").notNull(),
  supplementaryNote: text("supplementary_note"),
  publicNote: text("public_note"),
  status: communityAwardStatusEnum("status").notNull().default("pending_review"),
  reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNote: text("review_note"),
  recipientPolicy: text("recipient_policy").$type<"single" | "limited" | "all_ties">().notNull().default("single"),
  recipientLimit: integer("recipient_limit").default(1),
  settlementPolicy: text("settlement_policy").$type<"event_verified" | "play_in_complete" | "stage_complete" | "season_complete">().notNull().default("season_complete"),
  settlementStageKey: text("settlement_stage_key"),
  resultVersion: integer("result_version").notNull().default(0),
  /** Rolling-release projection only; recipients relation owns the complete list. */
  recipientUserId: uuid("recipient_user_id").references(() => users.id, { onDelete: "set null" }),
  outcomeNote: text("outcome_note"),
  outcomeByUserId: uuid("outcome_by_user_id").references(() => users.id, { onDelete: "set null" }),
  outcomeAt: timestamp("outcome_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  recipientPolicyCheck: check("community_awards_recipient_policy_check", sql`(${t.recipientPolicy} = 'single' AND ${t.recipientLimit} IS NOT NULL AND ${t.recipientLimit} = 1) OR (${t.recipientPolicy} = 'limited' AND ${t.recipientLimit} IS NOT NULL AND ${t.recipientLimit} >= 2) OR (${t.recipientPolicy} = 'all_ties' AND ${t.recipientLimit} IS NULL)`),
  settlementPolicyCheck: check("community_awards_settlement_policy_check", sql`(${t.settlementPolicy} IN ('event_verified', 'play_in_complete', 'season_complete') AND ${t.settlementStageKey} IS NULL) OR (${t.settlementPolicy} = 'stage_complete' AND ${t.settlementStageKey} IS NOT NULL AND length(trim(${t.settlementStageKey})) > 0)`),
  seasonStatusIndex: index("community_awards_season_id_status_idx").on(t.seasonId, t.status),
  nonBlankFields: check(
    "community_awards_non_blank_fields_check",
    sql`length(trim(${t.name})) > 0 AND length(trim(${t.condition})) > 0 AND length(trim(${t.prize})) > 0`,
  ),
  reviewCheck: check(
    "community_awards_review_check",
    sql`(${t.status} = 'pending_review' AND ((${t.reviewedByUserId} IS NULL AND ${t.reviewedAt} IS NULL) OR (${t.reviewedByUserId} IS NOT NULL AND ${t.reviewedAt} IS NOT NULL)))
      OR (${t.status} IN ('rejected', 'approved', 'awarded', 'not_awarded', 'cancelled') AND ${t.reviewedByUserId} IS NOT NULL AND ${t.reviewedAt} IS NOT NULL)
      OR (${t.status} = 'withdrawn')`,
  ),
  outcomeCheck: check(
    "community_awards_outcome_check",
    sql`(${t.status} = 'awarded' AND ${t.recipientUserId} IS NOT NULL AND ${t.outcomeByUserId} IS NOT NULL AND ${t.outcomeAt} IS NOT NULL)
      OR (${t.status} IN ('not_awarded', 'cancelled', 'withdrawn') AND ${t.recipientUserId} IS NULL AND ${t.outcomeByUserId} IS NOT NULL AND ${t.outcomeAt} IS NOT NULL)
      OR (${t.status} IN ('pending_review', 'rejected', 'approved') AND ${t.recipientUserId} IS NULL AND ${t.outcomeByUserId} IS NULL AND ${t.outcomeAt} IS NULL)`,
  ),
}));

/** Complete current outcome; audit_logs retain previous lists and reasons. */
export const communityAwardRecipients = pgTable("community_award_recipients", {
  awardId: uuid("award_id").notNull().references(() => communityAwards.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  position: integer("position").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.awardId, t.userId] }),
  positionCheck: check("community_award_recipients_position_check", sql`${t.position} >= 0`),
}));

/** Optional evidence submitted for a community award; it never changes match truth. */
export const communityAwardEvidence = pgTable("community_award_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  awardId: uuid("award_id").notNull().references(() => communityAwards.id, { onDelete: "cascade" }),
  submittedByUserId: uuid("submitted_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  candidateUserId: uuid("candidate_user_id").references(() => users.id, { onDelete: "set null" }),
  matchId: uuid("match_id").references(() => matches.id, { onDelete: "set null" }),
  verificationStatus: text("verification_status").$type<"pending" | "eligible" | "ineligible">().notNull().default("pending"),
  verifiedByUserId: uuid("verified_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verificationNote: text("verification_note"),
  explanation: text("explanation").notNull(),
  videoUrl: text("video_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  verificationCheck: check("community_award_evidence_verification_check", sql`(${t.verificationStatus} = 'pending' AND ${t.verifiedByUserId} IS NULL AND ${t.verifiedAt} IS NULL AND ${t.verificationNote} IS NULL) OR (${t.verificationStatus} IN ('eligible', 'ineligible') AND ${t.verifiedByUserId} IS NOT NULL AND ${t.verifiedAt} IS NOT NULL AND ${t.verificationNote} IS NOT NULL AND length(trim(${t.verificationNote})) > 0)`),
  awardIndex: index("community_award_evidence_award_id_idx").on(t.awardId),
  nonBlankExplanation: check("community_award_evidence_non_blank_explanation_check", sql`length(trim(${t.explanation})) > 0`),
}));

export type CommunityAward = typeof communityAwards.$inferSelect;
export type CommunityAwardEvidence = typeof communityAwardEvidence.$inferSelect;

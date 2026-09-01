import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { matches } from "./matches";
import { seasons } from "./seasons";
import { users } from "./users";

export const communityAwardStatusEnum = pgEnum("community_award_status", [
  "pending_review", "rejected", "approved", "withdrawn", "awarded", "not_awarded", "cancelled",
]);

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
  recipientUserId: uuid("recipient_user_id").references(() => users.id, { onDelete: "set null" }),
  outcomeNote: text("outcome_note"),
  outcomeByUserId: uuid("outcome_by_user_id").references(() => users.id, { onDelete: "set null" }),
  outcomeAt: timestamp("outcome_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
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

/** Optional evidence submitted for a community award; it never changes match truth. */
export const communityAwardEvidence = pgTable("community_award_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  awardId: uuid("award_id").notNull().references(() => communityAwards.id, { onDelete: "cascade" }),
  submittedByUserId: uuid("submitted_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  candidateUserId: uuid("candidate_user_id").references(() => users.id, { onDelete: "set null" }),
  matchId: uuid("match_id").references(() => matches.id, { onDelete: "set null" }),
  explanation: text("explanation").notNull(),
  videoUrl: text("video_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  awardIndex: index("community_award_evidence_award_id_idx").on(t.awardId),
  nonBlankExplanation: check("community_award_evidence_non_blank_explanation_check", sql`length(trim(${t.explanation})) > 0`),
}));

export type CommunityAward = typeof communityAwards.$inferSelect;
export type CommunityAwardEvidence = typeof communityAwardEvidence.$inferSelect;

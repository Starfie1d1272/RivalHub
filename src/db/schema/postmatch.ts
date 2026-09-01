import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { matches } from "./matches";
import { seasons } from "./seasons";
import { users } from "./users";

export const postMatchReportStatusEnum = pgEnum("post_match_report_status", ["draft", "submitted", "returned", "confirmed"]);

/**
 * Actual commentators for a match. A migration trigger keeps this scoped to a
 * current season_admin grant; confirmation snapshots the fee and later
 * settlement is represented on each confirmed participation.
 */
export const matchCommentators = pgTable("match_commentators", {
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  addedByUserId: uuid("added_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  confirmedByUserId: uuid("confirmed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  confirmedFeeCents: integer("confirmed_fee_cents"),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  settledByUserId: uuid("settled_by_user_id").references(() => users.id, { onDelete: "set null" }),
}, (t) => ({
  pk: primaryKey({ columns: [t.matchId, t.userId], name: "match_commentators_match_id_user_id_pk" }),
  userIndex: index("match_commentators_user_id_idx").on(t.userId),
  confirmedFeeCheck: check(
    "match_commentators_confirmed_fee_check",
    sql`(${t.confirmedAt} IS NULL AND ${t.confirmedFeeCents} IS NULL AND ${t.confirmedByUserId} IS NULL)
      OR (${t.confirmedAt} IS NOT NULL AND ${t.confirmedFeeCents} IS NOT NULL AND ${t.confirmedFeeCents} >= 0 AND ${t.confirmedByUserId} IS NOT NULL)`,
  ),
  settlementCheck: check(
    "match_commentators_settlement_check",
    sql`(${t.settledAt} IS NULL AND ${t.settledByUserId} IS NULL)
      OR (${t.settledAt} IS NOT NULL AND ${t.settledByUserId} IS NOT NULL AND ${t.confirmedAt} IS NOT NULL)`,
  ),
}));

/** One explicit operational completion record per match, separate from match truth. */
export const postMatchReports = pgTable("post_match_reports", {
  matchId: uuid("match_id").primaryKey().references(() => matches.id, { onDelete: "cascade" }),
  seasonId: uuid("season_id").notNull().references(() => seasons.id, { onDelete: "cascade" }),
  status: postMatchReportStatusEnum("status").notNull().default("draft"),
  submittedByUserId: uuid("submitted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  confirmedByUserId: uuid("confirmed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  returnedByUserId: uuid("returned_by_user_id").references(() => users.id, { onDelete: "set null" }),
  returnedAt: timestamp("returned_at", { withTimezone: true }),
  returnReason: text("return_reason"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  seasonIndex: index("post_match_reports_season_id_status_idx").on(t.seasonId, t.status),
  submissionCheck: check(
    "post_match_reports_submission_check",
    sql`(${t.status} IN ('submitted', 'returned', 'confirmed') AND ${t.submittedByUserId} IS NOT NULL AND ${t.submittedAt} IS NOT NULL)
      OR (${t.status} = 'draft' AND ${t.submittedByUserId} IS NULL AND ${t.submittedAt} IS NULL)`,
  ),
  confirmationCheck: check(
    "post_match_reports_confirmation_check",
    sql`(${t.status} = 'confirmed' AND ${t.confirmedByUserId} IS NOT NULL AND ${t.confirmedAt} IS NOT NULL)
      OR (${t.status} <> 'confirmed' AND ${t.confirmedByUserId} IS NULL AND ${t.confirmedAt} IS NULL)`,
  ),
  returnCheck: check(
    "post_match_reports_return_check",
    sql`(${t.status} = 'returned' AND ${t.returnedByUserId} IS NOT NULL AND ${t.returnedAt} IS NOT NULL AND length(trim(coalesce(${t.returnReason}, ''))) > 0)
      OR (${t.status} <> 'returned' AND ${t.returnedByUserId} IS NULL AND ${t.returnedAt} IS NULL AND ${t.returnReason} IS NULL)`,
  ),
}));

export type MatchCommentator = typeof matchCommentators.$inferSelect;
export type PostMatchReport = typeof postMatchReports.$inferSelect;

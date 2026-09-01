import { index, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { matches } from "./matches";
import { users } from "./users";

/**
 * Actual commentators for a match. A migration trigger keeps this scoped to a
 * current season_admin grant. Once a submission fact exists the roster is
 * frozen until an administrator explicitly reopens it.
 */
export const matchCommentators = pgTable("match_commentators", {
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  addedByUserId: uuid("added_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.matchId, t.userId], name: "match_commentators_match_id_user_id_pk" }),
  userIndex: index("match_commentators_user_id_idx").on(t.userId),
}));

/** One immutable-until-reopened submission fact per match. Completion is derived with matches.video_url. */
export const postMatchReports = pgTable("post_match_reports", {
  matchId: uuid("match_id").primaryKey().references(() => matches.id, { onDelete: "cascade" }),
  submittedByUserId: uuid("submitted_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  submittedByIndex: index("post_match_reports_submitted_by_user_id_idx").on(t.submittedByUserId),
}));

export type MatchCommentator = typeof matchCommentators.$inferSelect;
export type PostMatchReport = typeof postMatchReports.$inferSelect;

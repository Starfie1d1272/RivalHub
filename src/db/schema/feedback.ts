import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { seasons } from "./seasons";
import { users } from "./users";

export const feedbackCategoryEnum = pgEnum("feedback_category", [
  "problem",
  "question",
  "feature_suggestion",
  "content_correction",
  "other",
]);
export const feedbackStatusEnum = pgEnum("feedback_status", ["new", "triaged", "resolved"]);

export const feedbackReports = pgTable("feedback_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  seasonId: uuid("season_id").references(() => seasons.id, { onDelete: "set null" }),
  category: feedbackCategoryEnum("category").notNull(),
  body: text("body").notNull(),
  /** Internal deduplication fact; never included in any DTO. */
  bodyFingerprint: text("body_fingerprint").notNull(),
  pathname: text("pathname").notNull(),
  releaseVersion: text("release_version").notNull(),
  status: feedbackStatusEnum("status").notNull().default("new"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  bodyShape: check("feedback_reports_body_shape_check", sql`char_length(${t.body}) BETWEEN 1 AND 4000`),
  statusCreatedAtIndex: index("feedback_reports_status_created_at_idx").on(t.status, t.createdAt),
  userCreatedAtIndex: index("feedback_reports_user_created_at_idx").on(t.userId, t.createdAt),
  fingerprintCreatedAtIndex: index("feedback_reports_fingerprint_created_at_idx").on(t.bodyFingerprint, t.createdAt),
  seasonCreatedAtIndex: index("feedback_reports_season_created_at_idx").on(t.seasonId, t.createdAt),
}));

export type FeedbackReport = typeof feedbackReports.$inferSelect;
export type NewFeedbackReport = typeof feedbackReports.$inferInsert;

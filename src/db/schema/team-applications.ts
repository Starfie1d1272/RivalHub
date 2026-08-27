import { index, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { seasons } from "./seasons";
import { users } from "./users";

export const teamApplicationStatusEnum = pgEnum("team_application_status", [
  "draft",
  "submitted",
  "approved",
  "waitlisted",
  "rejected",
]);

export const teamApplicationMemberStatusEnum = pgEnum("team_application_member_status", [
  "invited",
  "confirmed",
]);

/**
 * A team application is deliberately separate from a competition team. It is
 * the mutable participant-side aggregate until an administrator approves it.
 */
export const teamApplications = pgTable("team_applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  captainUserId: uuid("captain_user_id").notNull().references(() => users.id),
  status: teamApplicationStatusEnum("status").notNull().default("draft"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: text("reviewed_by"),
  reviewReason: text("review_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  seasonStatusIndex: index("team_applications_season_status_idx").on(t.seasonId, t.status),
}));

export const teamApplicationMembers = pgTable("team_application_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicationId: uuid("application_id").notNull().references(() => teamApplications.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id),
  status: teamApplicationMemberStatusEnum("status").notNull().default("invited"),
  invitedByUserId: uuid("invited_by_user_id").notNull().references(() => users.id),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueApplicationUser: unique("team_application_members_application_user_unique").on(t.applicationId, t.userId),
  userStatusIndex: index("team_application_members_user_status_idx").on(t.userId, t.status),
}));

/**
 * The transaction-owned claim table provides the cross-application uniqueness
 * that a partial index cannot express through team_applications.status.
 */
export const teamApplicationActiveClaims = pgTable("team_application_active_claims", {
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  applicationId: uuid("application_id").notNull().references(() => teamApplications.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  primary: unique("team_application_active_claims_season_user_unique").on(t.seasonId, t.userId),
  applicationIndex: index("team_application_active_claims_application_idx").on(t.applicationId),
}));

export type TeamApplication = typeof teamApplications.$inferSelect;
export type TeamApplicationMember = typeof teamApplicationMembers.$inferSelect;

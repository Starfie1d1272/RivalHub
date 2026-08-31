import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const teamLifecycleEnum = pgEnum("team_lifecycle", ["active", "disbanded"]);
export const teamMembershipStatusEnum = pgEnum("team_membership_status", ["active", "benched", "left"]);
export const teamMembershipEndReasonEnum = pgEnum("team_membership_end_reason", ["left", "kicked", "disbanded"]);
export const teamInvitationKindEnum = pgEnum("team_invitation_kind", ["direct", "share_link"]);
export const teamInvitationStatusEnum = pgEnum("team_invitation_status", ["pending", "accepted", "declined", "revoked", "expired"]);

/** A long-lived collective identity. It never belongs to a competition. */
export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  description: text("description"),
  recruiting: boolean("recruiting").notNull().default(false),
  status: teamLifecycleEnum("status").notNull().default("active"),
  creatorUserId: uuid("creator_user_id").notNull().references(() => users.id),
  captainUserId: uuid("captain_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  disbandedAt: timestamp("disbanded_at", { withTimezone: true }),
  disbandedBy: text("disbanded_by"),
}, (t) => ({
  slugUnique: uniqueIndex("teams_slug_unique").on(t.slug),
  oneActiveCaptaincyPerUser: uniqueIndex("teams_one_active_captaincy_per_user")
    .on(t.captainUserId)
    .where(sql`${t.status} = 'active'`),
  lifecycleShape: check(
    "teams_lifecycle_shape_check",
    sql`(${t.status} = 'active' AND ${t.disbandedAt} IS NULL) OR (${t.status} = 'disbanded' AND ${t.disbandedAt} IS NOT NULL)`,
  ),
}));

/** One immutable join/rejoin period. A rejoin always creates a new row. */
export const teamMemberships = pgTable("team_memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull().references(() => teams.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  status: teamMembershipStatusEnum("status").notNull().default("active"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  endedReason: teamMembershipEndReasonEnum("ended_reason"),
  invitedByUserId: uuid("invited_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  teamIndex: index("team_memberships_team_idx").on(t.teamId),
  userIndex: index("team_memberships_user_idx").on(t.userId),
  oneCurrentPeriod: uniqueIndex("team_memberships_one_current_period")
    .on(t.teamId, t.userId)
    .where(sql`${t.endedAt} IS NULL`),
  oneCurrentTeamPerUser: uniqueIndex("team_memberships_one_current_team_per_user")
    .on(t.userId)
    .where(sql`${t.endedAt} IS NULL`),
  periodShape: check(
    "team_memberships_period_shape_check",
    sql`(${t.endedAt} IS NULL AND ${t.endedReason} IS NULL AND ${t.status} <> 'left') OR (${t.endedAt} IS NOT NULL AND ${t.endedReason} IS NOT NULL AND ${t.status} = 'left')`,
  ),
}));

export const teamCaptainChanges = pgTable("team_captain_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull().references(() => teams.id),
  fromUserId: uuid("from_user_id").references(() => users.id),
  toUserId: uuid("to_user_id").notNull().references(() => users.id),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  changedByActorId: text("changed_by_actor_id").notNull(),
}, (t) => ({
  teamChangedAtIndex: index("team_captain_changes_team_changed_at_idx").on(t.teamId, t.changedAt),
}));

export const teamNameChanges = pgTable("team_name_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull().references(() => teams.id),
  oldName: text("old_name"),
  newName: text("new_name").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  changedByActorId: text("changed_by_actor_id").notNull(),
}, (t) => ({
  teamChangedAtIndex: index("team_name_changes_team_changed_at_idx").on(t.teamId, t.changedAt),
}));

export const teamSlugAliases = pgTable("team_slug_aliases", {
  slug: text("slug").primaryKey(),
  teamId: uuid("team_id").notNull().references(() => teams.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teamInvitations = pgTable("team_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull().references(() => teams.id),
  kind: teamInvitationKindEnum("kind").notNull(),
  invitedUserId: uuid("invited_user_id").references(() => users.id),
  tokenHash: text("token_hash"),
  status: teamInvitationStatusEnum("status").notNull().default("pending"),
  invitedByUserId: uuid("invited_by_user_id").notNull().references(() => users.id),
  respondedByUserId: uuid("responded_by_user_id").references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  teamStatusIndex: index("team_invitations_team_status_idx").on(t.teamId, t.status),
  userStatusIndex: index("team_invitations_user_status_idx").on(t.invitedUserId, t.status),
  tokenHashUnique: uniqueIndex("team_invitations_token_hash_unique").on(t.tokenHash),
  onePendingDirectInvite: uniqueIndex("team_invitations_one_pending_direct_per_user")
    .on(t.teamId, t.invitedUserId)
    .where(sql`${t.kind} = 'direct' AND ${t.status} = 'pending'`),
  invitationShape: check(
    "team_invitations_kind_shape_check",
    sql`(${t.kind} = 'direct' AND ${t.invitedUserId} IS NOT NULL AND ${t.tokenHash} IS NULL) OR (${t.kind} = 'share_link' AND ${t.invitedUserId} IS NULL AND ${t.tokenHash} IS NOT NULL)`,
  ),
  responseShape: check(
    "team_invitations_response_shape_check",
    sql`(${t.status} IN ('accepted', 'declined') AND ${t.respondedAt} IS NOT NULL AND ${t.respondedByUserId} IS NOT NULL)
      OR (${t.status} IN ('pending', 'revoked', 'expired') AND ${t.respondedAt} IS NULL AND ${t.respondedByUserId} IS NULL)`,
  ),
}));

export type Team = typeof teams.$inferSelect;
export type TeamMembership = typeof teamMemberships.$inferSelect;
export type TeamCaptainChange = typeof teamCaptainChanges.$inferSelect;
export type TeamNameChange = typeof teamNameChanges.$inferSelect;
export type TeamInvitation = typeof teamInvitations.$inferSelect;

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { matches } from "./matches";
import { competitionEntries } from "./competition-entries";
import { users } from "./users";

export const matchVetoAppealStatusEnum = pgEnum("match_veto_appeal_status", ["pending", "accepted", "rejected"]);
export const matchVetoResolutionScopeEnum = pgEnum("match_veto_resolution_scope", [
  "platform_or_organizer",
  "participant_or_unverified",
]);

/** Collaboration and timer state. BAN/PICK/SIDE decisions remain in match_veto_steps. */
export const matchVetoSessions = pgTable("match_veto_sessions", {
  matchId: uuid("match_id").primaryKey().references(() => matches.id, { onDelete: "cascade" }),
  privilegedEntryId: uuid("privileged_entry_id").references(() => competitionEntries.id),
  vetoTeamAEntryId: uuid("veto_team_a_entry_id").references(() => competitionEntries.id),
  entryAStartRequestedAt: timestamp("entry_a_start_requested_at", { withTimezone: true }),
  entryAStartRequestedBy: uuid("entry_a_start_requested_by").references(() => users.id, { onDelete: "set null" }),
  entryBStartRequestedAt: timestamp("entry_b_start_requested_at", { withTimezone: true }),
  entryBStartRequestedBy: uuid("entry_b_start_requested_by").references(() => users.id, { onDelete: "set null" }),
  mapPoolSnapshot: jsonb("map_pool_snapshot").$type<string[]>(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  currentTurnKey: text("current_turn_key"),
  turnStartedAt: timestamp("turn_started_at", { withTimezone: true }),
  turnDeadlineAt: timestamp("turn_deadline_at", { withTimezone: true }),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  pausedBy: uuid("paused_by").references(() => users.id, { onDelete: "set null" }),
  pauseReason: text("pause_reason"),
  revision: integer("revision").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  nonnegativeRevision: check("match_veto_sessions_revision_check", sql`${t.revision} >= 0`),
  entryARequestShape: check(
    "match_veto_sessions_entry_a_request_shape_check",
    sql`(${t.entryAStartRequestedAt} IS NULL) = (${t.entryAStartRequestedBy} IS NULL)`,
  ),
  entryBRequestShape: check(
    "match_veto_sessions_entry_b_request_shape_check",
    sql`(${t.entryBStartRequestedAt} IS NULL) = (${t.entryBStartRequestedBy} IS NULL)`,
  ),
  pauseShape: check(
    "match_veto_sessions_pause_shape_check",
    sql`(${t.pausedAt} IS NULL AND ${t.pausedBy} IS NULL AND ${t.pauseReason} IS NULL)
      OR (${t.pausedAt} IS NOT NULL AND ${t.pausedBy} IS NOT NULL AND ${t.pauseReason} IS NOT NULL)`,
  ),
  activeDeadline: index("match_veto_sessions_active_deadline_idx")
    .on(t.turnDeadlineAt)
    .where(sql`${t.startedAt} IS NOT NULL AND ${t.completedAt} IS NULL AND ${t.pausedAt} IS NULL`),
}));
export const matchVetoTimeoutIncidents = pgTable("match_veto_timeout_incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  turnKey: text("turn_key").notNull(),
  entryId: uuid("entry_id").references(() => competitionEntries.id),
  representativeUserId: uuid("representative_user_id").references(() => users.id, { onDelete: "set null" }),
  deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull(),
  eligibleOptions: jsonb("eligible_options").$type<string[]>().notNull(),
  selectedOptions: jsonb("selected_options").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byMatch: index("match_veto_timeout_incidents_match_created_idx").on(t.matchId, t.createdAt),
}));

export const matchVetoAppeals = pgTable("match_veto_appeals", {
  id: uuid("id").primaryKey().defaultRandom(),
  timeoutIncidentId: uuid("timeout_incident_id").notNull().references(() => matchVetoTimeoutIncidents.id, { onDelete: "cascade" }),
  submittedBy: uuid("submitted_by").notNull().references(() => users.id),
  reason: text("reason").notNull(),
  status: matchVetoAppealStatusEnum("status").notNull().default("pending"),
  resolutionScope: matchVetoResolutionScopeEnum("resolution_scope"),
  resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
  resolutionNote: text("resolution_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (t) => ({
  reasonNotBlank: check("match_veto_appeals_reason_check", sql`length(btrim(${t.reason})) > 0`),
  resolutionShape: check(
    "match_veto_appeals_resolution_shape_check",
    sql`(${t.status} = 'pending' AND ${t.resolutionScope} IS NULL AND ${t.resolvedBy} IS NULL AND ${t.resolvedAt} IS NULL)
      OR (${t.status} <> 'pending' AND ${t.resolutionScope} IS NOT NULL AND ${t.resolvedBy} IS NOT NULL AND ${t.resolvedAt} IS NOT NULL)`,
  ),
  onePendingAppeal: uniqueIndex("match_veto_appeals_one_pending_per_incident")
    .on(t.timeoutIncidentId)
    .where(sql`${t.status} = 'pending'`),
}));

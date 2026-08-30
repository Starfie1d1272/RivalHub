import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { seasons } from "./seasons";
import { educationVerifications } from "./education";
import { seasonRegistrations } from "./registrations";
import { teamMemberships, teams } from "./teams";
import { users } from "./users";

export const competitionEntrySourceEnum = pgEnum("competition_entry_source", ["linked_team", "event_native"]);
export const competitionEntryRegistrationStatusEnum = pgEnum("competition_entry_registration_status", [
  "draft", "submitted", "changes_requested", "waitlisted", "approved", "rejected", "withdrawn",
]);
export const competitionEntryParticipantStatusEnum = pgEnum("competition_entry_participant_status", [
  "invited", "confirmed", "declined", "withdrawn",
]);
export const competitionEntryRosterRevisionStatusEnum = pgEnum("competition_entry_roster_revision_status", [
  "draft", "submitted", "approved", "superseded",
]);
export const competitionEntrySubmissionDecisionEnum = pgEnum("competition_entry_submission_decision", [
  "submitted", "changes_requested", "waitlisted", "approved", "rejected", "withdrawn",
]);
export const eventRosterStatusEnum = pgEnum("event_roster_status", ["preparing", "confirmed", "frozen"]);

/** The canonical identity of one entrant from registration draft through history. */
export const competitionEntries = pgTable("competition_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  competitionId: uuid("competition_id").notNull().references(() => seasons.id),
  source: competitionEntrySourceEnum("source").notNull(),
  teamId: uuid("team_id").references(() => teams.id),
  /** Event-native formation provenance (for example a Rivals captain registration). */
  sourceRegistrationId: uuid("source_registration_id").references(() => seasonRegistrations.id),
  /** Event-native formation order; never reused as tournament seeding. */
  formationOrder: integer("formation_order"),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  representativeUserId: uuid("representative_user_id").notNull().references(() => users.id),
  registrationStatus: competitionEntryRegistrationStatusEnum("registration_status").notNull().default("draft"),
  perfectTeamId: text("perfect_team_id"),
  currentRosterRevision: integer("current_roster_revision").notNull().default(1),
  approvedRosterRevision: integer("approved_roster_revision"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewReason: text("review_reason"),
  /** Migration provenance only; never used as business identity or authority. */
  legacySourceType: text("legacy_source_type"),
  legacySourceId: uuid("legacy_source_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  competitionStatusIndex: index("competition_entries_competition_status_idx").on(t.competitionId, t.registrationStatus),
  teamHistoryIndex: index("competition_entries_team_history_idx").on(t.teamId, t.competitionId),
  legacySourceUnique: uniqueIndex("competition_entries_legacy_source_unique").on(t.legacySourceType, t.legacySourceId),
  oneEffectiveEntryPerTeamCompetition: uniqueIndex("competition_entries_one_effective_team_per_competition")
    .on(t.competitionId, t.teamId)
    .where(sql`${t.teamId} IS NOT NULL AND ${t.registrationStatus} NOT IN ('rejected', 'withdrawn')`),
  competitionFormationOrderUnique: uniqueIndex("competition_entries_competition_formation_order_unique")
    .on(t.competitionId, t.formationOrder)
    .where(sql`${t.formationOrder} IS NOT NULL`),
  sourceShape: check(
    "competition_entries_source_shape_check",
    sql`(${t.source} = 'linked_team' AND ${t.teamId} IS NOT NULL) OR (${t.source} = 'event_native' AND ${t.teamId} IS NULL)`,
  ),
  revisionShape: check(
    "competition_entries_revision_shape_check",
    sql`${t.currentRosterRevision} >= 1 AND (${t.approvedRosterRevision} IS NULL OR (${t.approvedRosterRevision} >= 1 AND ${t.approvedRosterRevision} <= ${t.currentRosterRevision}))`,
  ),
}));

/** Stable per-entry commitment. It is not a frozen roster or match appearance. */
export const competitionEntryParticipants = pgTable("competition_entry_participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryId: uuid("entry_id").notNull().references(() => competitionEntries.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  status: competitionEntryParticipantStatusEnum("status").notNull().default("invited"),
  invitedByUserId: uuid("invited_by_user_id").references(() => users.id),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  entryUserUnique: unique("competition_entry_participants_entry_user_unique").on(t.entryId, t.userId),
  userStatusIndex: index("competition_entry_participants_user_status_idx").on(t.userId, t.status),
  confirmationShape: check(
    "competition_entry_participants_confirmation_shape_check",
    sql`(${t.status} = 'confirmed' AND ${t.confirmedAt} IS NOT NULL AND ${t.withdrawnAt} IS NULL)
      OR (${t.status} = 'withdrawn' AND ${t.withdrawnAt} IS NOT NULL)
      OR (${t.status} IN ('invited', 'declined') AND ${t.confirmedAt} IS NULL AND ${t.withdrawnAt} IS NULL)`,
  ),
}));

/** Exists only after the player explicitly confirms this competition commitment. */
export const competitionEntryActiveClaims = pgTable("competition_entry_active_claims", {
  competitionId: uuid("competition_id").notNull().references(() => seasons.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  entryId: uuid("entry_id").notNull().references(() => competitionEntries.id),
  participantId: uuid("participant_id").notNull().references(() => competitionEntryParticipants.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  oneActiveCommitment: unique("competition_entry_active_claims_competition_user_unique").on(t.competitionId, t.userId),
  participantUnique: unique("competition_entry_active_claims_participant_unique").on(t.participantId),
  entryIndex: index("competition_entry_active_claims_entry_idx").on(t.entryId),
}));

export const competitionEntryRosterRevisions = pgTable("competition_entry_roster_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryId: uuid("entry_id").notNull().references(() => competitionEntries.id),
  revision: integer("revision").notNull(),
  status: competitionEntryRosterRevisionStatusEnum("status").notNull().default("draft"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
}, (t) => ({
  entryRevisionUnique: unique("competition_entry_roster_revisions_entry_revision_unique").on(t.entryId, t.revision),
  positiveRevision: check("competition_entry_roster_revisions_positive_check", sql`${t.revision} >= 1`),
}));

export const competitionEntryRosterMembers = pgTable("competition_entry_roster_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  revisionId: uuid("revision_id").notNull().references(() => competitionEntryRosterRevisions.id),
  participantId: uuid("participant_id").notNull().references(() => competitionEntryParticipants.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  teamMembershipId: uuid("team_membership_id").references(() => teamMemberships.id),
  isPrimaryStarter: boolean("is_primary_starter").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  revisionParticipantUnique: unique("competition_entry_roster_members_revision_participant_unique").on(t.revisionId, t.participantId),
  revisionUserUnique: unique("competition_entry_roster_members_revision_user_unique").on(t.revisionId, t.userId),
}));

/** Append-only review history. The Entry status is only the current registration projection. */
export const competitionEntrySubmissions = pgTable("competition_entry_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryId: uuid("entry_id").notNull().references(() => competitionEntries.id),
  rosterRevisionId: uuid("roster_revision_id").notNull().references(() => competitionEntryRosterRevisions.id),
  sequence: integer("sequence").notNull(),
  decision: competitionEntrySubmissionDecisionEnum("decision").notNull().default("submitted"),
  submittedBy: text("submitted_by").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  reason: text("reason"),
}, (t) => ({
  entrySequenceUnique: unique("competition_entry_submissions_entry_sequence_unique").on(t.entryId, t.sequence),
  positiveSequence: check("competition_entry_submissions_positive_check", sql`${t.sequence} >= 1`),
}));

export const competitionEntryRepresentativeTenures = pgTable("competition_entry_representative_tenures", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryId: uuid("entry_id").notNull().references(() => competitionEntries.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  transferredBy: text("transferred_by"),
}, (t) => ({
  oneCurrentRepresentative: uniqueIndex("competition_entry_representative_one_current")
    .on(t.entryId)
    .where(sql`${t.endedAt} IS NULL`),
}));

/**
 * Append-only migration provenance. These identifiers are never accepted as
 * runtime entrant identity; they only make historical imports auditable.
 */
export const competitionEntryLegacyIdentities = pgTable("competition_entry_legacy_identities", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryId: uuid("entry_id").notNull().references(() => competitionEntries.id),
  legacyType: text("legacy_type").notNull(),
  legacyId: uuid("legacy_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  legacyIdentityUnique: unique("competition_entry_legacy_identities_type_id_unique")
    .on(t.legacyType, t.legacyId),
  entryIndex: index("competition_entry_legacy_identities_entry_idx").on(t.entryId),
}));

/** Canonical event/frozen roster, independent of mutable participant commitments. */
export const eventRosters = pgTable("event_rosters", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryId: uuid("entry_id").notNull().references(() => competitionEntries.id),
  sourceRosterRevisionId: uuid("source_roster_revision_id").references(() => competitionEntryRosterRevisions.id),
  status: eventRosterStatusEnum("status").notNull().default("preparing"),
  policySnapshot: jsonb("policy_snapshot").notNull().default(sql`'{}'::jsonb`),
  frozenAt: timestamp("frozen_at", { withTimezone: true }),
  frozenBy: text("frozen_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  oneRosterPerEntry: unique("event_rosters_entry_unique").on(t.entryId),
  freezeShape: check(
    "event_rosters_freeze_shape_check",
    sql`(${t.status} IN ('preparing', 'confirmed') AND ${t.frozenAt} IS NULL) OR (${t.status} = 'frozen' AND ${t.frozenAt} IS NOT NULL)`,
  ),
}));

export const eventRosterMembers = pgTable("event_roster_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventRosterId: uuid("event_roster_id").notNull().references(() => eventRosters.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  participantId: uuid("participant_id").references(() => competitionEntryParticipants.id),
  educationVerificationId: uuid("education_verification_id").references(() => educationVerifications.id),
  isPrimaryStarter: boolean("is_primary_starter").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  rosterUserUnique: unique("event_roster_members_roster_user_unique").on(t.eventRosterId, t.userId),
  participantUnique: unique("event_roster_members_participant_unique").on(t.eventRosterId, t.participantId),
  rosterIndex: index("event_roster_members_roster_idx").on(t.eventRosterId),
}));

export type CompetitionEntry = typeof competitionEntries.$inferSelect;
export type CompetitionEntryParticipant = typeof competitionEntryParticipants.$inferSelect;
export type CompetitionEntryRosterRevision = typeof competitionEntryRosterRevisions.$inferSelect;
export type EventRoster = typeof eventRosters.$inferSelect;
export type EventRosterMember = typeof eventRosterMembers.$inferSelect;

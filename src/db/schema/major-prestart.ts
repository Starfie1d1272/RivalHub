import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { seasons } from "./seasons";
import { teams } from "./teams";
import { users } from "./users";

export const majorPrestartIssueCategoryEnum = pgEnum("major_prestart_issue_category", [
  "qualification",
  "administration",
]);

/**
 * Per-season lifecycle facts. The lack of a row means the Major has not yet
 * entered prestart preparation; actions materialize it before changing facts.
 */
export const majorPrestartStates = pgTable("major_prestart_states", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().unique().references(() => seasons.id),
  entrantsLockedAt: timestamp("entrants_locked_at", { withTimezone: true }),
  entrantsLockedBy: text("entrants_locked_by"),
  /** Incremented whenever the saved tournament order changes. */
  seedRevision: integer("seed_revision").notNull().default(0),
  /** Equal to seedRevision only after an administrator explicitly reconfirms it. */
  confirmedSeedRevision: integer("confirmed_seed_revision"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** The selected official participant set; it is not inferred from all teams. */
export const majorPrestartEntrants = pgTable("major_prestart_entrants", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  teamId: uuid("team_id").notNull().references(() => teams.id),
  rosterConfirmedAt: timestamp("roster_confirmed_at", { withTimezone: true }),
  rosterConfirmedBy: text("roster_confirmed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueSeasonTeam: unique("major_prestart_entrants_season_team_unique").on(t.seasonId, t.teamId),
  seasonIndex: index("major_prestart_entrants_season_idx").on(t.seasonId),
}));

/** Immutable-after-lock tournament roster snapshot, distinct from match_rosters. */
export const majorPrestartRosterMembers = pgTable("major_prestart_roster_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  entrantId: uuid("entrant_id").notNull().references(() => majorPrestartEntrants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueEntrantUser: unique("major_prestart_roster_members_entrant_user_unique").on(t.entrantId, t.userId),
  entrantIndex: index("major_prestart_roster_members_entrant_idx").on(t.entrantId),
}));

/** Explicit work items. Empty means none are recorded, never an inferred fact. */
export const majorPrestartIssues = pgTable("major_prestart_issues", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  category: majorPrestartIssueCategoryEnum("category").notNull(),
  label: text("label").notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: text("resolved_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  seasonCategoryIndex: index("major_prestart_issues_season_category_idx").on(t.seasonId, t.category),
}));

export type MajorPrestartState = typeof majorPrestartStates.$inferSelect;
export type MajorPrestartEntrant = typeof majorPrestartEntrants.$inferSelect;
export type MajorPrestartRosterMember = typeof majorPrestartRosterMembers.$inferSelect;
export type MajorPrestartIssue = typeof majorPrestartIssues.$inferSelect;

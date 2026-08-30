import {
  index,
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { seasons } from "./seasons";
import { competitionEntries, eventRosters } from "./competition-entries";

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
  /** The confirmed 1–32 tournament order becomes immutable when the Major starts. */
  seedsLockedAt: timestamp("seeds_locked_at", { withTimezone: true }),
  seedsLockedBy: text("seeds_locked_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** The selected official participant set; it is not inferred from all teams. */
export const majorPrestartEntrants = pgTable("major_prestart_entrants", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  competitionEntryId: uuid("competition_entry_id").notNull().references(() => competitionEntries.id),
  eventRosterId: uuid("event_roster_id").references(() => eventRosters.id),
  rosterConfirmedAt: timestamp("roster_confirmed_at", { withTimezone: true }),
  rosterConfirmedBy: text("roster_confirmed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueSeasonEntry: unique("major_prestart_entrants_season_entry_unique").on(t.seasonId, t.competitionEntryId),
  eventRosterUnique: unique("major_prestart_entrants_event_roster_unique").on(t.eventRosterId),
  seasonIndex: index("major_prestart_entrants_season_idx").on(t.seasonId),
}));

/** Independent Major 1–32 tournament order. It must never reuse teams.draftOrder. */
export const majorTournamentSeeds = pgTable("major_tournament_seeds", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  entrantId: uuid("entrant_id").notNull().references(() => majorPrestartEntrants.id),
  tournamentSeed: integer("tournament_seed").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueSeasonEntrant: unique("major_tournament_seeds_season_entrant_unique").on(t.seasonId, t.entrantId),
  uniqueSeasonSeed: unique("major_tournament_seeds_season_seed_unique").on(t.seasonId, t.tournamentSeed),
  seasonIndex: index("major_tournament_seeds_season_idx").on(t.seasonId),
  validSeed: check("major_tournament_seeds_seed_range_check", sql`${t.tournamentSeed} BETWEEN 1 AND 32`),
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
export type MajorTournamentSeed = typeof majorTournamentSeeds.$inferSelect;
export type MajorPrestartIssue = typeof majorPrestartIssues.$inferSelect;

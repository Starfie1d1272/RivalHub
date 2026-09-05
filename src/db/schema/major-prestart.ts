import {
  index,
  check,
  foreignKey,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { seasons } from "./seasons";
import { competitionEntries } from "./competition-entries";

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
  /** Explicit confirmation is cleared by every seed edit. */
  seedsConfirmedAt: timestamp("seeds_confirmed_at", { withTimezone: true }),
  seedsConfirmedBy: text("seeds_confirmed_by"),
  /** The confirmed 1–32 tournament order becomes immutable when the Major starts. */
  seedsLockedAt: timestamp("seeds_locked_at", { withTimezone: true }),
  seedsLockedBy: text("seeds_locked_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  seedConfirmationShape: check(
    "major_prestart_states_seed_confirmation_shape_check",
    sql`(${t.seedsConfirmedAt} IS NULL) = (${t.seedsConfirmedBy} IS NULL)`,
  ),
  seedLockShape: check(
    "major_prestart_states_seed_lock_shape_check",
    sql`(${t.seedsLockedAt} IS NULL) = (${t.seedsLockedBy} IS NULL)`,
  ),
  entrantLockShape: check(
    "major_prestart_states_entrant_lock_shape_check",
    sql`(${t.entrantsLockedAt} IS NULL) = (${t.entrantsLockedBy} IS NULL)`,
  ),
}));

/** The selected official participant set; it is not inferred from all teams. */
export const majorTournamentEntrants = pgTable("major_tournament_entrants", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  competitionEntryId: uuid("competition_entry_id").notNull().references(() => competitionEntries.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueSeasonEntry: unique("major_tournament_entrants_season_entry_unique").on(t.seasonId, t.competitionEntryId),
  identityScope: unique("major_tournament_entrants_id_season_unique").on(t.id, t.seasonId),
  entrySeasonScope: foreignKey({
    columns: [t.competitionEntryId, t.seasonId],
    foreignColumns: [competitionEntries.id, competitionEntries.competitionId],
    name: "major_tournament_entrants_entry_season_scope_fk",
  }),
  seasonIndex: index("major_tournament_entrants_season_idx").on(t.seasonId),
}));

/** Independent Major 1–32 tournament order. It must never reuse teams.draftOrder. */
export const majorTournamentSeeds = pgTable("major_tournament_seeds", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  tournamentEntrantId: uuid("tournament_entrant_id").notNull().references(() => majorTournamentEntrants.id),
  seed: integer("seed").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueSeasonEntrant: unique("major_tournament_seeds_season_entrant_unique").on(t.seasonId, t.tournamentEntrantId),
  uniqueSeasonSeed: unique("major_tournament_seeds_season_seed_unique").on(t.seasonId, t.seed),
  entrantSeasonScope: foreignKey({
    columns: [t.tournamentEntrantId, t.seasonId],
    foreignColumns: [majorTournamentEntrants.id, majorTournamentEntrants.seasonId],
    name: "major_tournament_seeds_entrant_season_scope_fk",
  }),
  seasonIndex: index("major_tournament_seeds_season_idx").on(t.seasonId),
  validSeed: check("major_tournament_seeds_seed_range_check", sql`${t.seed} BETWEEN 1 AND 32`),
}));

/** Immutable event-scoped explanation of the system seed recommendation. */
export const majorSeedRecommendationSnapshots = pgTable("major_seed_recommendation_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().unique().references(() => seasons.id),
  entrantSetFingerprint: text("entrant_set_fingerprint").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  context: jsonb("context").$type<Record<string, unknown>>().notNull(),
  recommendations: jsonb("recommendations").$type<unknown[]>().notNull(),
});

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
export type MajorTournamentEntrant = typeof majorTournamentEntrants.$inferSelect;
export type MajorTournamentSeed = typeof majorTournamentSeeds.$inferSelect;
export type MajorSeedRecommendationSnapshot = typeof majorSeedRecommendationSnapshots.$inferSelect;
export type MajorPrestartIssue = typeof majorPrestartIssues.$inferSelect;

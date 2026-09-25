import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { competitionEntries } from "./competition-entries";
import { seasons } from "./seasons";

export const competitionQualificationFormatEnum = pgEnum("competition_qualification_format", [
  "direct_bo3",
  "short_swiss_2w2l",
]);

/** Immutable candidate set and lifecycle for the separate pre-Major Play-in. */
export const competitionQualificationRuns = pgTable("competition_qualification_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().unique().references(() => seasons.id),
  format: competitionQualificationFormatEnum("format").notNull(),
  targetEntrantCount: integer("target_entrant_count").notNull(),
  candidateCount: integer("candidate_count").notNull(),
  directEntryCount: integer("direct_entry_count").notNull(),
  playInEntryCount: integer("play_in_entry_count").notNull(),
  qualifierCount: integer("qualifier_count").notNull(),
  configuredAt: timestamp("configured_at", { withTimezone: true }).notNull().defaultNow(),
  configuredBy: text("configured_by").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  startedBy: text("started_by"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  identityScope: unique("competition_qualification_runs_id_season_unique").on(t.id, t.seasonId),
  entrantCounts: check(
    "competition_qualification_runs_counts_check",
    sql`${t.candidateCount} = ${t.directEntryCount} + ${t.playInEntryCount}
      AND ${t.targetEntrantCount} = ${t.directEntryCount} + ${t.qualifierCount}
      AND ${t.playInEntryCount} = ${t.qualifierCount} * 2
      AND ${t.playInEntryCount} >= 2
      AND ${t.candidateCount} > ${t.targetEntrantCount}`,
  ),
  positiveCounts: check(
    "competition_qualification_runs_positive_counts_check",
    sql`${t.targetEntrantCount} > 0 AND ${t.directEntryCount} >= 0 AND ${t.qualifierCount} > 0`,
  ),
  startedByShape: check(
    "competition_qualification_runs_started_by_shape_check",
    sql`(${t.startedAt} IS NULL) = (${t.startedBy} IS NULL)`,
  ),
  completedAfterStart: check(
    "competition_qualification_runs_completed_after_start_check",
    sql`${t.completedAt} IS NULL OR ${t.startedAt} IS NOT NULL`,
  ),
}));

/** Frozen preliminary order; route is derived from the parent run's direct-entry cut. */
export const competitionQualificationEntrants = pgTable("competition_qualification_entrants", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull(),
  seasonId: uuid("season_id").notNull(),
  competitionEntryId: uuid("competition_entry_id").notNull(),
  preliminarySeed: integer("preliminary_seed").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  runEntryUnique: unique("competition_qualification_entrants_run_entry_unique").on(t.runId, t.competitionEntryId),
  runSeedUnique: unique("competition_qualification_entrants_run_seed_unique").on(t.runId, t.preliminarySeed),
  identityScope: unique("competition_qualification_entrants_id_run_unique").on(t.id, t.runId),
  runSeasonScope: foreignKey({
    columns: [t.runId, t.seasonId],
    foreignColumns: [competitionQualificationRuns.id, competitionQualificationRuns.seasonId],
    name: "competition_qualification_entrants_run_season_scope_fk",
  }),
  entrySeasonScope: foreignKey({
    columns: [t.competitionEntryId, t.seasonId],
    foreignColumns: [competitionEntries.id, competitionEntries.competitionId],
    name: "competition_qualification_entrants_entry_season_scope_fk",
  }),
  validSeed: check("competition_qualification_entrants_seed_check", sql`${t.preliminarySeed} >= 1`),
  seasonIndex: index("competition_qualification_entrants_season_idx").on(t.seasonId),
}));

export type CompetitionQualificationRun = typeof competitionQualificationRuns.$inferSelect;
export type CompetitionQualificationEntrant = typeof competitionQualificationEntrants.$inferSelect;

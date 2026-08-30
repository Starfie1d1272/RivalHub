import { check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { majorPrestartEntrants } from "./major-prestart";
import { seasons } from "./seasons";
import { competitionEntries } from "./competition-entries";

/**
 * A materialized Major stage. It owns generated matches and keeps the rules
 * that were accepted at the point of launch, rather than consulting mutable
 * season configuration later.
 */
export const majorStageRuns = pgTable("major_stage_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  stageKey: text("stage_key").notNull(),
  ruleSnapshot: jsonb("rule_snapshot").notNull(),
  /**
   * The last Swiss round whose results were explicitly accepted by an
   * operator. This is deliberately separate from finished matches: results
   * may be corrected until the operator finalizes the round.
   */
  finalizedRound: integer("finalized_round").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  startedBy: text("started_by").notNull(),
}, (t) => ({
  uniqueSeasonStage: unique("major_stage_runs_season_stage_unique").on(t.seasonId, t.stageKey),
  validFinalizedRound: check("major_stage_runs_finalized_round_range_check", sql`${t.finalizedRound} BETWEEN 0 AND 5`),
  seasonIndex: index("major_stage_runs_season_idx").on(t.seasonId),
}));

/** Immutable StageRun membership; stage seed is scoped to its own stage. */
export const majorStageEntrants = pgTable("major_stage_entrants", {
  id: uuid("id").primaryKey().defaultRandom(),
  stageRunId: uuid("stage_run_id").notNull().references(() => majorStageRuns.id, { onDelete: "cascade" }),
  entrantId: uuid("entrant_id").notNull().references(() => majorPrestartEntrants.id),
  competitionEntryId: uuid("competition_entry_id").notNull().references(() => competitionEntries.id),
  tournamentSeed: integer("tournament_seed").notNull(),
  stageSeed: integer("stage_seed").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueRunEntrant: unique("major_stage_entrants_run_entrant_unique").on(t.stageRunId, t.entrantId),
  uniqueRunEntry: unique("major_stage_entrants_run_entry_unique").on(t.stageRunId, t.competitionEntryId),
  uniqueRunSeed: unique("major_stage_entrants_run_seed_unique").on(t.stageRunId, t.stageSeed),
  validStageSeed: check("major_stage_entrants_stage_seed_range_check", sql`${t.stageSeed} BETWEEN 1 AND 16`),
  runIndex: index("major_stage_entrants_run_idx").on(t.stageRunId),
}));

export const majorResultStatusEnum = pgEnum("major_result_status", ["pending_confirmation", "confirmed"]);

/** Official output is materialized only after the last managed playoff match. */
export const majorFinalResults = pgTable("major_final_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  playoffStageRunId: uuid("playoff_stage_run_id").notNull().references(() => majorStageRuns.id),
  championEntryId: uuid("champion_entry_id").notNull().references(() => competitionEntries.id),
  placementGroups: jsonb("placement_groups").notNull(),
  status: majorResultStatusEnum("status").notNull().default("pending_confirmation"),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }).notNull().defaultNow(),
  finalizedBy: text("finalized_by").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  confirmedBy: text("confirmed_by"),
}, (t) => ({
  uniqueSeason: unique("major_final_results_season_unique").on(t.seasonId),
  uniquePlayoffRun: unique("major_final_results_playoff_run_unique").on(t.playoffStageRunId),
  seasonIndex: index("major_final_results_season_idx").on(t.seasonId),
}));

export type MajorStageRun = typeof majorStageRuns.$inferSelect;
export type MajorStageEntrant = typeof majorStageEntrants.$inferSelect;
export type MajorFinalResult = typeof majorFinalResults.$inferSelect;

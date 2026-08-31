import { check, foreignKey, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { majorTournamentEntrants } from "./major-prestart";
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
  identityScope: unique("major_stage_runs_id_season_unique").on(t.id, t.seasonId),
  validFinalizedRound: check("major_stage_runs_finalized_round_range_check", sql`${t.finalizedRound} BETWEEN 0 AND 5`),
  seasonIndex: index("major_stage_runs_season_idx").on(t.seasonId),
}));

/** Immutable StageRun membership; stage seed is scoped to its own stage. */
export const majorStageEntrants = pgTable("major_stage_entrants", {
  id: uuid("id").primaryKey().defaultRandom(),
  stageRunId: uuid("stage_run_id").notNull().references(() => majorStageRuns.id, { onDelete: "cascade" }),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  tournamentEntrantId: uuid("tournament_entrant_id").notNull().references(() => majorTournamentEntrants.id),
  stageSeed: integer("stage_seed").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueRunEntrant: unique("major_stage_entrants_run_entrant_unique").on(t.stageRunId, t.tournamentEntrantId),
  uniqueRunSeed: unique("major_stage_entrants_run_seed_unique").on(t.stageRunId, t.stageSeed),
  validStageSeed: check("major_stage_entrants_stage_seed_range_check", sql`${t.stageSeed} BETWEEN 1 AND 16`),
  runSeasonScope: foreignKey({ columns: [t.stageRunId, t.seasonId], foreignColumns: [majorStageRuns.id, majorStageRuns.seasonId], name: "major_stage_entrants_run_season_scope_fk" }),
  entrantSeasonScope: foreignKey({ columns: [t.tournamentEntrantId, t.seasonId], foreignColumns: [majorTournamentEntrants.id, majorTournamentEntrants.seasonId], name: "major_stage_entrants_tournament_entrant_season_scope_fk" }),
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
  playoffRunSeasonScope: foreignKey({ columns: [t.playoffStageRunId, t.seasonId], foreignColumns: [majorStageRuns.id, majorStageRuns.seasonId], name: "major_final_results_playoff_run_season_scope_fk" }),
  championSeasonScope: foreignKey({ columns: [t.championEntryId, t.seasonId], foreignColumns: [competitionEntries.id, competitionEntries.competitionId], name: "major_final_results_champion_entry_season_scope_fk" }),
  confirmationShape: check("major_final_results_confirmation_shape_check", sql`(${t.status} = 'pending_confirmation' AND ${t.confirmedAt} IS NULL AND ${t.confirmedBy} IS NULL) OR (${t.status} = 'confirmed' AND ${t.confirmedAt} IS NOT NULL AND ${t.confirmedBy} IS NOT NULL)`),
  seasonIndex: index("major_final_results_season_idx").on(t.seasonId),
}));

export type MajorStageRun = typeof majorStageRuns.$inferSelect;
export type MajorStageEntrant = typeof majorStageEntrants.$inferSelect;
export type MajorFinalResult = typeof majorFinalResults.$inferSelect;

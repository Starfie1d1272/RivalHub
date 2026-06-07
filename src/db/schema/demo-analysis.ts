import type {
  AnalysisBundle,
  MatchWorkspaceModel,
  QaReport,
  SeasonCohortBundle,
  SeasonLeaderboardModel,
} from "@cs2dak/contract";
import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { demoImports } from "./demo";
import { seasons } from "./seasons";

export const analysisRunStatusEnum = pgEnum("analysis_run_status", [
  "processing",
  "ready",
  "failed",
  "superseded",
]);

export const demoAnalysisRuns = pgTable("demo_analysis_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  importId: uuid("import_id").notNull().references(() => demoImports.id, { onDelete: "cascade" }),
  status: analysisRunStatusEnum("status").notNull().default("processing"),
  analysisVersion: text("analysis_version").notNull(),
  ratingVersion: text("rating_version"),
  analysisBundle: jsonb("analysis_bundle").$type<AnalysisBundle>(),
  workspaceModel: jsonb("workspace_model").$type<MatchWorkspaceModel>(),
  qaReport: jsonb("qa_report").$type<QaReport>(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => ({
  importStatusIdx: index("demo_analysis_runs_import_status_idx").on(t.importId, t.status),
}));

export const seasonAnalysisRuns = pgTable("season_analysis_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id, { onDelete: "cascade" }),
  status: analysisRunStatusEnum("status").notNull().default("processing"),
  cohortVersion: text("cohort_version").notNull(),
  ratingVersion: text("rating_version"),
  sourceFingerprint: text("source_fingerprint").notNull(),
  cohortBundle: jsonb("cohort_bundle").$type<SeasonCohortBundle>(),
  leaderboardModel: jsonb("leaderboard_model").$type<SeasonLeaderboardModel>(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => ({
  seasonStatusIdx: index("season_analysis_runs_season_status_idx").on(t.seasonId, t.status),
}));

export type DemoAnalysisRun = typeof demoAnalysisRuns.$inferSelect;
export type SeasonAnalysisRun = typeof seasonAnalysisRuns.$inferSelect;

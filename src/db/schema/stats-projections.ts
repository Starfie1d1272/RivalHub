import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { TournamentMapFacts, TournamentPerformanceMapProjection } from "@cs2dak/tournament";
import { matchDemoImports } from "./demo-integration";

export interface StatisticsProjectionBinding { steam64: string; userId: string; entryId: string }
export interface StatisticsProjectionFacts {
  tournament: TournamentMapFacts;
  performance: TournamentPerformanceMapProjection;
}

/** Rebuildable, versioned statistics; raw Evidence stays immutable in match_demo_imports. */
export const matchDemoStatProjections = pgTable("match_demo_stat_projections", {
  importId: uuid("import_id").notNull().references(() => matchDemoImports.id, { onDelete: "cascade" }),
  projectionVersion: text("projection_version").notNull(),
  payloadSha256: text("payload_sha256").notNull(),
  demoSha256: text("demo_sha256").notNull(),
  semanticProfile: text("semantic_profile").notNull(),
  analysisVersion: text("analysis_version").notNull(),
  evidenceRevision: text("evidence_revision").notNull(),
  identityBindings: jsonb("identity_bindings").$type<StatisticsProjectionBinding[]>().notNull(),
  facts: jsonb("facts").$type<StatisticsProjectionFacts>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  identity: primaryKey({ columns: [t.importId, t.projectionVersion] }),
  shaShape: check("match_demo_stat_projections_sha_shape_check", sql`${t.payloadSha256} ~ '^[a-f0-9]{64}$' AND ${t.demoSha256} ~ '^[a-f0-9]{64}$'`),
  bindingsShape: check("match_demo_stat_projections_bindings_shape_check", sql`jsonb_typeof(${t.identityBindings}) = 'array' AND jsonb_array_length(${t.identityBindings}) = 10`),
  factsShape: check("match_demo_stat_projections_facts_shape_check", sql`jsonb_typeof(${t.facts}) = 'object' AND ${t.facts} ? 'tournament' AND ${t.facts} ? 'performance'`),
}));

export type MatchDemoStatProjection = typeof matchDemoStatProjections.$inferSelect;

/** One rotating repair cursor per reducer version; not a coverage or completion assertion. */
export const statisticsProjectionRepairCursors = pgTable("statistics_projection_repair_cursors", {
  projectionVersion: text("projection_version").primaryKey(),
  afterMapId: uuid("after_map_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

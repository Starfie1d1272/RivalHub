import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

// An adoption is a reviewed series-level fact; original map observations remain intact.
export const matchActualStartAdoptions = pgTable("match_actual_start_adoptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull(),
  matchId: uuid("match_id").notNull(),
  revision: integer("revision").notNull(),
  requestId: uuid("request_id").notNull(),
  originalFactAt: timestamp("original_fact_at", { withTimezone: true, mode: "string" }),
  previousAt: timestamp("previous_at", { withTimezone: true, mode: "string" }),
  actualAt: timestamp("actual_at", { withTimezone: true, mode: "string" }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "string" }).notNull().default(sql`clock_timestamp()`),
  actorId: text("actor_id").notNull(),
  reason: text("reason").notNull(),
  evidence: text("evidence").notNull(),
}, t => [unique().on(t.matchId, t.revision), unique().on(t.matchId, t.requestId), index("match_actual_start_season_match_idx").on(t.seasonId, t.matchId),
  check("match_actual_start_revision_positive", sql`${t.revision} > 0`),
  check("match_actual_start_explanation", sql`length(trim(${t.reason})) between 1 and 500 and length(trim(${t.evidence})) between 1 and 500`),
]).enableRLS();

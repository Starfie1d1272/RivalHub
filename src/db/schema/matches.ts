import { pgTable, uuid, integer, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { seasons } from "./seasons";
import { teams } from "./teams";

// TODO: add more match statuses if needed (e.g. forfeit, cancelled)
export const matchStatusEnum = pgEnum("match_status", [
  "scheduled",
  "in_progress",
  "finished",
  "cancelled",
]);

export const matches = pgTable("matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  teamAId: uuid("team_a_id").notNull().references(() => teams.id),
  teamBId: uuid("team_b_id").notNull().references(() => teams.id),
  scoreA: integer("score_a"),
  scoreB: integer("score_b"),
  status: matchStatusEnum("status").notNull().default("scheduled"),
  bracketNodeId: text("bracket_node_id"), // brackets-manager node reference
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Match = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;

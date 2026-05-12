import { pgTable, uuid, integer, text, timestamp, pgEnum, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { seasons } from "./seasons";
import { teams } from "./teams";

export const matchStatusEnum = pgEnum("match_status", [
  "scheduled",
  "in_progress",
  "finished",
  "cancelled",
]);

// 比赛格式：BO1 / BO3 / BO5（决定 BP 流程与图数）
export const matchFormatEnum = pgEnum("match_format", ["bo1", "bo3", "bo5"]);

export const matches = pgTable("matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  teamAId: uuid("team_a_id").notNull().references(() => teams.id),
  teamBId: uuid("team_b_id").notNull().references(() => teams.id),

  // ── 比赛元数据 ────────────────────────────────────────────────────────
  stage: text("stage").notNull(),                                        // StageConfig.key
  round: integer("round"),                                               // swiss round; null for round_robin / elim
  format: matchFormatEnum("format").notNull().default("bo1"),            // bo1 | bo3 | bo5
  entryRound: text("entry_round"),                                       // bracket entry round; null for non-elimination stages
  // ──────────────────────────────────────────────────────────────────────

  // 整场系列赛比分（如 BO3 中 2:1）
  // 单图比分见 match_maps 表
  scoreA: integer("score_a"),
  scoreB: integer("score_b"),

  status: matchStatusEnum("status").notNull().default("scheduled"),
  bracketNodeId: text("bracket_node_id"),  // brackets-manager 节点引用

  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  completionDeadline: timestamp("completion_deadline", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // 双方不能是同一支队
  teamsAreDifferent: check("matches_teams_different", sql`${t.teamAId} != ${t.teamBId}`),
  // 系列赛比分非负
  scoreANonNegative: check("matches_score_a_nonneg", sql`${t.scoreA} IS NULL OR ${t.scoreA} >= 0`),
  scoreBNonNegative: check("matches_score_b_nonneg", sql`${t.scoreB} IS NULL OR ${t.scoreB} >= 0`),
}));

export type Match = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;

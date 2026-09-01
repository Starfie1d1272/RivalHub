import { pgTable, uuid, integer, text, timestamp, pgEnum, check, boolean, uniqueIndex, index, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { majorStageRuns } from "./major-stage";
import { seasons } from "./seasons";
import { competitionEntries } from "./competition-entries";

export const matchStatusEnum = pgEnum("match_status", [
  "scheduled",
  "in_progress",
  "finished",
  "cancelled",
]);

// 比赛格式：BO1 / BO3 / BO5（决定 BP 流程与图数）
export const matchFormatEnum = pgEnum("match_format", ["bo1", "bo3", "bo5"]);
export const matchOwnershipEnum = pgEnum("match_ownership", ["manual", "major_stage"]);

export const matches = pgTable("matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  seasonId: uuid("season_id").notNull().references(() => seasons.id),
  entryAId: uuid("entry_a_id").notNull().references(() => competitionEntries.id),
  entryBId: uuid("entry_b_id").notNull().references(() => competitionEntries.id),

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
  isForfeit: boolean("is_forfeit").notNull().default(false),
  bracketNodeId: text("bracket_node_id"),  // brackets-manager 节点引用
  /** Manual matches never carry a run/key; generated Major matches always do. */
  ownership: matchOwnershipEnum("ownership").notNull().default("manual"),
  majorStageRunId: uuid("major_stage_run_id").references(() => majorStageRuns.id),
  managedKey: text("managed_key"),

  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  completionDeadline: timestamp("completion_deadline", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  // 赛后公开录像链接；赛果、地图和玩家数据仍由各自的 canonical table 持有。
  videoUrl: text("video_url"),
  mvpWinnerUserId: uuid("mvp_winner_user_id"), // 投票截止后锁定的 MVP 胜者
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // 双方不能是同一支队
  entriesAreDifferent: check("matches_entries_different", sql`${t.entryAId} != ${t.entryBId}`),
  entryASeasonScope: foreignKey({ columns: [t.entryAId, t.seasonId], foreignColumns: [competitionEntries.id, competitionEntries.competitionId], name: "matches_entry_a_season_scope_fk" }),
  entryBSeasonScope: foreignKey({ columns: [t.entryBId, t.seasonId], foreignColumns: [competitionEntries.id, competitionEntries.competitionId], name: "matches_entry_b_season_scope_fk" }),
  majorRunSeasonScope: foreignKey({ columns: [t.majorStageRunId, t.seasonId], foreignColumns: [majorStageRuns.id, majorStageRuns.seasonId], name: "matches_major_stage_run_season_scope_fk" }),
  // 系列赛比分非负
  scoreANonNegative: check("matches_score_a_nonneg", sql`${t.scoreA} IS NULL OR ${t.scoreA} >= 0`),
  scoreBNonNegative: check("matches_score_b_nonneg", sql`${t.scoreB} IS NULL OR ${t.scoreB} >= 0`),
  managedMajorMatchShape: check(
    "matches_managed_major_match_shape",
    sql`(${t.ownership} = 'manual' AND ${t.majorStageRunId} IS NULL AND ${t.managedKey} IS NULL)
      OR (${t.ownership} = 'major_stage' AND ${t.majorStageRunId} IS NOT NULL AND ${t.managedKey} IS NOT NULL)`,
  ),
  uniqueManagedMajorMatch: uniqueIndex("matches_major_stage_run_managed_key_unique")
    .on(t.majorStageRunId, t.managedKey)
    .where(sql`${t.ownership} = 'major_stage'`),
  seasonStatusScheduleIndex: index("matches_season_status_scheduled_at_idx").on(t.seasonId, t.status, t.scheduledAt),
  entryAIndex: index("matches_entry_a_id_idx").on(t.entryAId),
  entryBIndex: index("matches_entry_b_id_idx").on(t.entryBId),
}));

export type Match = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;

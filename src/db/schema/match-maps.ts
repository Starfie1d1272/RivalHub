import { pgTable, uuid, integer, text, timestamp, pgEnum, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { matches } from "./matches";
import { teams } from "./teams";

// 起始边：T = 进攻方，CT = 防守方
export const sideEnum = pgEnum("side", ["t", "ct"]);

/**
 * 单图比赛记录
 *
 * BO1：1 行（mapOrder = 1，pickedByTeamId = null）
 * BO3：最多 3 行（mapOrder = 1..3，决胜图的 pickedByTeamId = null）
 * BO5：最多 5 行（mapOrder = 1..5，决胜图的 pickedByTeamId = null）
 *
 * v1 由 admin 手动录入；BP 全自动状态机为后续阶段。
 */
export const matchMaps = pgTable(
  "match_maps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id").notNull().references(() => matches.id),

    /** 第几张图（1-based，最大 5）*/
    mapOrder: integer("map_order").notNull(),

    /** 地图代号，如 "de_inferno"，约束放在应用层（赛季 mappool） */
    mapName: text("map_name").notNull(),

    /** 该图被哪支队 pick（决胜图为 null）*/
    pickedByTeamId: uuid("picked_by_team_id").references(() => teams.id),

    /** Team A 上半场起始边（决胜图由刀赛决定，结果填入此字段）*/
    teamAStartSide: sideEnum("team_a_start_side"),

    /** 单图比分（未开始为 null）*/
    scoreA: integer("score_a"),
    scoreB: integer("score_b"),

    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // 一场比赛内 mapOrder 唯一
    uniqueMatchOrder: unique().on(t.matchId, t.mapOrder),
    // mapOrder 在 1-5 之间（BO5 上限）
    mapOrderRange: check("match_maps_order_range", sql`${t.mapOrder} >= 1 AND ${t.mapOrder} <= 5`),
    // 单图比分非负（无上限，兼容加时赛）
    scoreANonNeg: check("match_maps_score_a_nonneg", sql`${t.scoreA} IS NULL OR ${t.scoreA} >= 0`),
    scoreBNonNeg: check("match_maps_score_b_nonneg", sql`${t.scoreB} IS NULL OR ${t.scoreB} >= 0`),
  })
);

export type MatchMap = typeof matchMaps.$inferSelect;
export type NewMatchMap = typeof matchMaps.$inferInsert;
